const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')

// dev 模式：开启 CDP 调试端口（仅开发用，release 不生效）
if (process.env['ELECTRON_RENDERER_URL']) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}
const path = require('path')
const fs = require('fs')
const mysql = require('mysql2/promise')

// ============ 连接池管理 ============
const pools = new Map()
let nextId = 1

const qi = (id) => '`' + String(id).replace(/`/g, '``') + '`'

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((row) =>
    Object.entries(row).map(([k, v]) => {
      if (v === null || v === undefined) return null
      if (Buffer.isBuffer(v)) return v.toString('utf8')
      if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
      if (typeof v === 'object') return String(v)
      return v
    })
  )
}

const normalizeColumns = (fields) => (fields || []).map((f) => f.name)

async function getPool(connId) {
  const entry = pools.get(connId)
  if (!entry) throw new Error('连接不存在或已断开')
  return entry
}

// ============ 配置持久化 ============
function configPath() {
  return path.join(app.getPath('userData'), 'connections.json')
}
function loadConfigs() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) } catch { return [] }
}
function saveConfigs(list) {
  fs.writeFileSync(configPath(), JSON.stringify(list, null, 2), 'utf8')
}

// SQL 值转义（导出 INSERT 用）
function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (Buffer.isBuffer(v)) return '0x' + v.toString('hex')
  const str = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
  return `'${str}'`
}

// ============ 连接配置 ============
ipcMain.handle('cfg:list', () => loadConfigs())

ipcMain.handle('cfg:save', (_e, config) => {
  const list = loadConfigs()
  const idx = list.findIndex((c) => c.id === config.id)
  if (idx >= 0) list[idx] = config
  else list.push({ ...config, id: config.id || 'c' + Date.now() })
  saveConfigs(list)
  return loadConfigs()
})

ipcMain.handle('cfg:delete', (_e, id) => {
  saveConfigs(loadConfigs().filter((c) => c.id !== id))
  return loadConfigs()
})

// ============ 连接生命周期 ============
ipcMain.handle('db:connect', async (_e, config) => {
  const pool = mysql.createPool({
    host: config.host,
    port: Number(config.port) || 3306,
    user: config.username,
    password: config.password || undefined,
    database: config.database || undefined,
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 6000,
    dateStrings: true,
    multipleStatements: true,
    charset: 'utf8mb4'
  })
  try {
    const [rows] = await pool.query('SELECT VERSION() v')
    const connId = 'c' + nextId++
    pools.set(connId, { pool, config })
    return { ok: true, connId, serverVersion: rows[0].v }
  } catch (err) {
    await pool.end().catch(() => {})
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('db:disconnect', async (_e, connId) => {
  const entry = pools.get(connId)
  if (entry) {
    await entry.pool.end().catch(() => {})
    pools.delete(connId)
  }
  return true
})

ipcMain.handle('db:test', async (_e, config) => {
  let conn
  try {
    conn = await mysql.createConnection({
      host: config.host,
      port: Number(config.port) || 3306,
      user: config.username,
      password: config.password || undefined,
      connectTimeout: 6000
    })
    const [rows] = await conn.query('SELECT VERSION() v')
    return { ok: true, serverVersion: rows[0].v }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    if (conn) await conn.end().catch(() => {})
  }
})

// ============ 元数据 ============
const SYSTEM_DBS = ['information_schema', 'performance_schema', 'sys', 'mysql']

ipcMain.handle('db:databases', async (_e, connId) => {
  const { pool } = await getPool(connId)
  const [rows] = await pool.query('SHOW DATABASES')
  return rows.map((r) => Object.values(r)[0]).filter((d) => !SYSTEM_DBS.includes(d))
})

ipcMain.handle('db:tables', async (_e, connId, database) => {
  const { pool } = await getPool(connId)
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
    [database]
  )
  return rows.map((r) => r.name)
})

ipcMain.handle('db:views', async (_e, connId, database) => {
  const { pool } = await getPool(connId)
  const [rows] = await pool.query(
    `SELECT TABLE_NAME AS name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [database]
  )
  return rows.map((r) => r.name)
})

ipcMain.handle('db:columns', async (_e, connId, database, table) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const [cols] = await pool.query(`SHOW FULL COLUMNS FROM ${full}`)
  // 外键列集合
  const [fkRows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [database, table]
  )
  const fkCols = new Set(fkRows.map((r) => r.COLUMN_NAME))
  return cols.map((c) => ({
    name: c.Field,
    type: c.Type,
    key: c.Key || '',
    isPrimary: c.Key === 'PRI',
    isForeign: fkCols.has(c.Field),
    nullable: c.Null === 'YES'
  }))
})

ipcMain.handle('db:foreignKeys', async (_e, connId, database, table) => {
  const { pool } = await getPool(connId)
  const [rows] = await pool.query(
    `SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName,
            k.REFERENCED_TABLE_SCHEMA AS refSchema, k.REFERENCED_TABLE_NAME AS refTable,
            k.REFERENCED_COLUMN_NAME AS refColumn,
            r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    [database, table]
  )
  return rows
})

ipcMain.handle('db:addForeignKey', async (_e, connId, database, table, fk) => {
  const { pool } = await getPool(connId)
  const name = fk.name || `fk_${table}_${fk.column}`
  const sql =
    `ALTER TABLE ${qi(database)}.${qi(table)} ` +
    `ADD CONSTRAINT ${qi(name)} FOREIGN KEY (${qi(fk.column)}) ` +
    `REFERENCES ${qi(fk.refSchema || database)}.${qi(fk.refTable)} (${qi(fk.refColumn)}) ` +
    `ON DELETE ${fk.onDelete || 'RESTRICT'} ON UPDATE ${fk.onUpdate || 'RESTRICT'}`
  await pool.query(sql)
  return { sql, name }
})

ipcMain.handle('db:dropForeignKey', async (_e, connId, database, table, name) => {
  const { pool } = await getPool(connId)
  await pool.query(`ALTER TABLE ${qi(database)}.${qi(table)} DROP FOREIGN KEY ${qi(name)}`)
  return true
})

// MySQL 不支持改 FK 约束 → drop + add 原子包装
ipcMain.handle('db:modifyForeignKey', async (_e, connId, database, table, oldName, fk) => {
  const { pool } = await getPool(connId)
  const conn = await pool.getConnection()
  try {
    await conn.query(`START TRANSACTION`)
    await conn.query(`ALTER TABLE ${qi(database)}.${qi(table)} DROP FOREIGN KEY ${qi(oldName)}`)
    const newName = fk.name || fk.column + '_fk'
    await conn.query(
      `ALTER TABLE ${qi(database)}.${qi(table)} ` +
      `ADD CONSTRAINT ${qi(newName)} FOREIGN KEY (${qi(fk.column)}) ` +
      `REFERENCES ${qi(database)}.${qi(fk.refTable)} (${qi(fk.refColumn)}) ` +
      `ON DELETE ${fk.onDelete || 'RESTRICT'} ON UPDATE ${fk.onUpdate || 'RESTRICT'}`
    )
    await conn.query(`COMMIT`)
    return { sql: `RENAME ... `, name: newName }
  } catch (e) {
    try { await conn.query(`ROLLBACK`) } catch {}
    throw e
  } finally {
    conn.release()
  }
})

ipcMain.handle('db:tableStructure', async (_e, connId, database, table) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const [columns] = await pool.query(`SHOW FULL COLUMNS FROM ${full}`)
  const [indexes] = await pool.query(`SHOW INDEX FROM ${full}`)
  let ddl = ''
  try {
    const [rows] = await pool.query(`SHOW CREATE TABLE ${full}`)
    ddl = rows[0]['Create Table'] || rows[0]['Create View'] || ''
  } catch (e) {
    ddl = '-- 无法获取 DDL: ' + e.message
  }
  return {
    columns: columns.map((c) => ({
      field: c.Field,
      type: c.Type,
      collation: c.Collation,
      nullable: c.Null === 'YES',
      key: c.Key || '',
      default: c.Default === undefined ? null : String(c.Default),
      extra: c.Extra,
      comment: c.Comment
    })),
    indexes: indexes.map((i) => ({
      name: i.Key_name,
      seq: i.Seq_in_index,
      column: i.Column_name,
      nonUnique: i.Non_unique === 1,
      cardinality: i.Cardinality,
      type: i.Index_type
    })),
    ddl
  }
})

// ============ 数据浏览 ============
ipcMain.handle('db:selectPage', async (_e, connId, database, table, opts = {}) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const where = opts.where && opts.where.trim() ? ` WHERE ${opts.where.trim()}` : ''
  const order = opts.sortCol
    ? ` ORDER BY ${qi(opts.sortCol)} ${opts.sortDir === 'desc' ? 'DESC' : 'ASC'}`
    : ''

  let pkColumns = []
  try {
    const [keys] = await pool.query(`SHOW KEYS FROM ${full} WHERE Key_name = 'PRIMARY'`)
    pkColumns = keys.sort((a, b) => a.Seq_in_index - b.Seq_in_index).map((k) => k.Column_name)
  } catch { /* 视图等无主键 */ }

  let total = 0
  try {
    const [[{ c }]] = await pool.query(`SELECT COUNT(*) AS c FROM ${full}${where}`)
    total = c
  } catch { /* 视图等场景 COUNT 可能受限 */ }
  const limit = Math.min(Number(opts.pageSize) || 100, 1000)
  const offset = Math.max(Number(opts.page) || 0, 0) * limit
  const [rows, fields] = await pool.query(
    `SELECT * FROM ${full}${where}${order} LIMIT ${limit} OFFSET ${offset}`
  )
  return { columns: normalizeColumns(fields), rows: normalizeRows(rows), total, pkColumns }
})

// ============ 数据编辑 ============
ipcMain.handle('db:updateCell', async (_e, connId, database, table, pkValues, column, value) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const where = Object.keys(pkValues).map((k) => `${qi(k)} = ?`).join(' AND ')
  const [ret] = await pool.query(
    `UPDATE ${full} SET ${qi(column)} = ? WHERE ${where} LIMIT 1`,
    [value, ...Object.values(pkValues)]
  )
  return { affected: ret.affectedRows }
})

ipcMain.handle('db:deleteRow', async (_e, connId, database, table, pkValues) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const where = Object.keys(pkValues).map((k) => `${qi(k)} = ?`).join(' AND ')
  const [ret] = await pool.query(`DELETE FROM ${full} WHERE ${where}`, Object.values(pkValues))
  return { affected: ret.affectedRows }
})

ipcMain.handle('db:insertRow', async (_e, connId, database, table, values) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const cols = Object.keys(values)
  if (!cols.length) throw new Error('没有可插入的值')
  const [ret] = await pool.query(
    `INSERT INTO ${full} (${cols.map(qi).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(values)
  )
  return { affected: ret.affectedRows, insertId: ret.insertId }
})

// ============ 库操作 ============
ipcMain.handle('db:charsets', async (_e, connId) => {
  const { pool } = await getPool(connId)
  const [charsets] = await pool.query('SHOW CHARACTER SET')
  const [collations] = await pool.query('SHOW COLLATION')
  return {
    charsets: charsets.map((c) => ({ name: c.Charset, desc: c.Description, defaultCollation: c['Default collation'] })),
    collations: collations.map((c) => ({ name: c.Collation, charset: c.Charset, isDefault: c.Default === 'Yes' }))
  }
})

ipcMain.handle('db:createDatabase', async (_e, connId, name, charset, collation) => {
  const { pool } = await getPool(connId)
  let sql = `CREATE DATABASE ${qi(name)}`
  if (charset) sql += ` CHARACTER SET ${charset}`
  if (collation) sql += ` COLLATE ${collation}`
  await pool.query(sql)
  return true
})

ipcMain.handle('db:dropDatabase', async (_e, connId, name) => {
  const { pool } = await getPool(connId)
  await pool.query(`DROP DATABASE ${qi(name)}`)
  return true
})

ipcMain.handle('db:alterDatabase', async (_e, connId, name, charset, collation) => {
  const { pool } = await getPool(connId)
  let sql = `ALTER DATABASE ${qi(name)}`
  if (charset) sql += ` CHARACTER SET ${charset}`
  if (collation) sql += ` COLLATE ${collation}`
  await pool.query(sql)
  return true
})

// ============ 表操作 ============
ipcMain.handle('db:dropTable', async (_e, connId, database, table) => {
  const { pool } = await getPool(connId)
  await pool.query(`DROP TABLE ${qi(database)}.${qi(table)}`)
  return true
})

ipcMain.handle('db:truncateTable', async (_e, connId, database, table) => {
  const { pool } = await getPool(connId)
  await pool.query(`TRUNCATE TABLE ${qi(database)}.${qi(table)}`)
  return true
})

ipcMain.handle('db:renameTable', async (_e, connId, database, table, newName) => {
  const { pool } = await getPool(connId)
  await pool.query(`RENAME TABLE ${qi(database)}.${qi(table)} TO ${qi(database)}.${qi(newName)}`)
  return true
})

// 建表：columns = [{name, type, length, nullable, key, autoIncrement, defaultValue, comment}]
ipcMain.handle('db:createTable', async (_e, connId, database, spec) => {
  const { pool } = await getPool(connId)
  const defs = spec.columns.map((c) => {
    let d = `  ${qi(c.name)} ${c.type}`
    if (c.length) d += `(${c.length})`
    d += c.nullable ? ' NULL' : ' NOT NULL'
    if (c.autoIncrement) d += ' AUTO_INCREMENT'
    if (c.defaultValue !== undefined && c.defaultValue !== null && c.defaultValue !== '') {
      const dv = String(c.defaultValue)
      d += ` DEFAULT ${/^(CURRENT_TIMESTAMP|NULL|NOW\(\))/i.test(dv) ? dv : `'${dv.replace(/'/g, "''")}'`}`
    }
    if (c.comment) d += ` COMMENT '${c.comment.replace(/'/g, "''")}'`
    return d
  })
  const pk = spec.columns.filter((c) => c.key === 'PRI').map((c) => qi(c.name))
  if (pk.length) defs.push(`  PRIMARY KEY (${pk.join(', ')})`)
  let sql = `CREATE TABLE ${qi(database)}.${qi(spec.name)} (\n${defs.join(',\n')}\n)`
  if (spec.engine) sql += ` ENGINE=${spec.engine}`
  if (spec.charset) sql += ` DEFAULT CHARSET=${spec.charset}`
  if (spec.collation) sql += ` COLLATE=${spec.collation}`
  if (spec.comment) sql += ` COMMENT='${spec.comment.replace(/'/g, "''")}'`
  await pool.query(sql)
  return { sql }
})

// 结构编辑
ipcMain.handle('db:addColumn', async (_e, connId, database, table, col) => {
  const { pool } = await getPool(connId)
  let d = `${qi(col.name)} ${col.type}`
  if (col.length) d += `(${col.length})`
  d += col.nullable ? ' NULL' : ' NOT NULL'
  if (col.autoIncrement) d += ' AUTO_INCREMENT'
  if (col.defaultValue) d += ` DEFAULT '${String(col.defaultValue).replace(/'/g, "''")}'`
  if (col.comment) d += ` COMMENT '${col.comment.replace(/'/g, "''")}'`
  const pos = col.after ? ` AFTER ${qi(col.after)}` : ''
  await pool.query(`ALTER TABLE ${qi(database)}.${qi(table)} ADD COLUMN ${d}${pos}`)
  return true
})

ipcMain.handle('db:modifyColumn', async (_e, connId, database, table, oldName, col) => {
  const { pool } = await getPool(connId)
  let d = `${qi(col.name)} ${col.type}`
  if (col.length) d += `(${col.length})`
  d += col.nullable ? ' NULL' : ' NOT NULL'
  if (col.autoIncrement) d += ' AUTO_INCREMENT'
  if (col.defaultValue !== undefined && col.defaultValue !== null && col.defaultValue !== '') {
    d += ` DEFAULT '${String(col.defaultValue).replace(/'/g, "''")}'`
  }
  if (col.comment !== undefined) d += ` COMMENT '${String(col.comment).replace(/'/g, "''")}'`
  await pool.query(`ALTER TABLE ${qi(database)}.${qi(table)} MODIFY COLUMN ${d}`)
  return true
})

ipcMain.handle('db:dropColumn', async (_e, connId, database, table, column) => {
  const { pool } = await getPool(connId)
  await pool.query(`ALTER TABLE ${qi(database)}.${qi(table)} DROP COLUMN ${qi(column)}`)
  return true
})

ipcMain.handle('db:renameColumn', async (_e, connId, database, table, oldName, newName) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const [cols] = await pool.query(`SHOW FULL COLUMNS FROM ${full}`)
  const col = cols.find((c) => c.Field === oldName)
  if (!col) throw new Error('列不存在: ' + oldName)
  let d = `${qi(newName)} ${col.Type}`
  d += col.Null === 'YES' ? ' NULL' : ' NOT NULL'
  if (col.Extra) d += ' ' + col.Extra
  if (col.Default !== null && col.Default !== undefined) d += ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'`
  if (col.Comment) d += ` COMMENT '${String(col.Comment).replace(/'/g, "''")}'`
  await pool.query(`ALTER TABLE ${full} CHANGE COLUMN ${qi(oldName)} ${d}`)
  return true
})

// ============ SQL 执行 ============
function normalizeStatement(rows, fields) {
  if (Array.isArray(rows)) {
    return { columns: normalizeColumns(fields), rows: normalizeRows(rows), affected: 0, info: '' }
  }
  return {
    columns: [],
    rows: [],
    affected: rows && rows.affectedRows != null ? rows.affectedRows : 0,
    info: (rows && rows.info) || ''
  }
}

ipcMain.handle('db:execute', async (_e, connId, database, sql) => {
  const { pool } = await getPool(connId)
  const conn = await pool.getConnection()
  try {
    if (database) await conn.query(`USE ${qi(database)}`)
    const start = Date.now()
    const [rows, fields] = await conn.query(sql)
    const elapsed = (Date.now() - start) / 1000

    const statements = []
    const looksMulti =
      Array.isArray(rows) &&
      rows.length > 0 &&
      (Array.isArray(rows[0]) || (rows[0] && typeof rows[0] === 'object' && 'affectedRows' in rows[0]))

    if (looksMulti) {
      rows.forEach((r, i) => statements.push(normalizeStatement(r, Array.isArray(fields) ? fields[i] : fields)))
    } else {
      statements.push(normalizeStatement(rows, fields))
    }
    return { ok: true, elapsed, statements }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    conn.release()
  }
})

// ============ 导出 ============
ipcMain.handle('db:export', async (_e, connId, database, table, format) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const ext = format === 'json' ? 'json' : 'csv'
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${database}.${table}.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }]
  })
  if (canceled || !filePath) return { canceled: true }

  const [rows, fields] = await pool.query(`SELECT * FROM ${full}`)
  const cols = normalizeColumns(fields)
  const data = normalizeRows(rows)
  let out
  if (format === 'json') {
    out = JSON.stringify(data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]]))), null, 2)
  } else {
    const esc = (v) => {
      if (v === null) return '\\N'
      const s = String(v)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    out = [cols.join(','), ...data.map((r) => r.map(esc).join(','))].join('\n')
  }
  fs.writeFileSync(filePath, out, 'utf8')
  shell.showItemInFolder(filePath)
  return { ok: true, path: filePath, rows: data.length }
})

// ============ SQL 导入导出 ============
ipcMain.handle('db:exportSql', async (_e, connId, database, table, mode) => {
  const { pool } = await getPool(connId)
  const full = `${qi(database)}.${qi(table)}`
  const suffix = mode === 'schema' ? 'schema' : 'full'
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${database}.${table}.${suffix}.sql`,
    filters: [{ name: 'SQL', extensions: ['sql'] }]
  })
  if (canceled || !filePath) return { canceled: true }

  const header = [
    `-- MySQLStudio 导出`,
    `-- 目标: ${database}.${table}`,
    `-- 模式: ${mode === 'schema' ? '仅结构' : '结构 + 数据'}`,
    `-- 时间: ${new Date().toISOString()}`,
    `-- 源服务器: MySQL ${(await pool.query('SELECT VERSION() v'))[0][0].v}`,
    '',
    `USE \`${database}\`;`,
    ''
  ].join('\n')

  let body = ''
  try {
    const [createRows] = await pool.query(`SHOW CREATE TABLE ${full}`)
    const ddl = createRows[0]['Create Table'] || createRows[0]['Create View'] || ''
    body += `-- ---------- 结构 ----------\nDROP TABLE IF EXISTS ${qi(table)};\n${ddl};\n`

    if (mode !== 'schema') {
      const [rows, fields] = await pool.query(`SELECT * FROM ${full}`)
      const cols = normalizeColumns(fields)
      if (rows.length) {
        body += `\n-- ---------- 数据（${rows.length} 行）----------\n`
        const batchSize = 200
        for (let i = 0; i < rows.length; i += batchSize) {
          const chunk = rows.slice(i, i + batchSize)
          const values = chunk
            .map((r) => `(${cols.map((c) => sqlLiteral(r[c])).join(', ')})`)
            .join(',\n  ')
          body += `INSERT INTO ${qi(table)} (${cols.map(qi).join(', ')}) VALUES\n  ${values};\n`
        }
      }
    }
  } catch (e) {
    body += `-- 导出失败: ${e.message}\n`
  }

  fs.writeFileSync(filePath, header + body, 'utf8')
  shell.showItemInFolder(filePath)
  return { ok: true, path: filePath }
})

// ---- 整个数据库导出（结构 / 结构+数据）----
ipcMain.handle('db:exportDatabase', async (_e, connId, database, mode) => {
  const { pool } = await getPool(connId)
  const suffix = mode === 'schema' ? 'schema' : 'full'
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${database}.${suffix}.sql`,
    filters: [{ name: 'SQL', extensions: ['sql'] }]
  })
  if (canceled || !filePath) return { canceled: true }

  const [verRows] = await pool.query('SELECT VERSION() v')
  const [objects] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
     ORDER BY TABLE_TYPE DESC, TABLE_NAME`,
    [database]
  )
  const tables = objects.filter((o) => o.type === 'BASE TABLE').map((o) => o.name)
  const views = objects.filter((o) => o.type === 'VIEW').map((o) => o.name)

  const lines = [
    `-- MySQLStudio 数据库导出`,
    `-- 数据库: ${database}`,
    `-- 模式: ${mode === 'schema' ? '仅结构' : '结构 + 数据'}`,
    `-- 时间: ${new Date().toISOString()}`,
    `-- 源服务器: MySQL ${verRows[0].v}`,
    `-- 表: ${tables.length} 张，视图: ${views.length} 个`,
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";',
    '',
    `CREATE DATABASE IF NOT EXISTS ${qi(database)} DEFAULT CHARACTER SET utf8mb4;`,
    `USE ${qi(database)};`,
    ''
  ]

  let totalRows = 0
  for (const t of tables) {
    const full = `${qi(database)}.${qi(t)}`
    try {
      const [createRows] = await pool.query(`SHOW CREATE TABLE ${full}`)
      const ddl = createRows[0]['Create Table'] || ''
      lines.push(`-- ---------- 表: ${t} ----------`)
      lines.push(`DROP TABLE IF EXISTS ${qi(t)};`)
      lines.push(ddl + ';')
      lines.push('')

      if (mode !== 'schema') {
        const [rows, fields] = await pool.query(`SELECT * FROM ${full}`)
        const cols = normalizeColumns(fields)
        if (rows.length) {
          totalRows += rows.length
          lines.push(`-- 数据: ${rows.length} 行`)
          const batchSize = 500
          for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize)
            const values = chunk
              .map((r) => `(${cols.map((c) => sqlLiteral(r[c])).join(', ')})`)
              .join(',\n  ')
            lines.push(`INSERT INTO ${qi(t)} (${cols.map(qi).join(', ')}) VALUES\n  ${values};`)
          }
          lines.push('')
        }
      }
    } catch (e) {
      lines.push(`-- 导出表 ${t} 失败: ${e.message}`, '')
    }
  }

  // 视图放最后（依赖表）
  for (const v of views) {
    try {
      const [createRows] = await pool.query(`SHOW CREATE VIEW ${qi(database)}.${qi(v)}`)
      const ddl = createRows[0]['Create View'] || ''
      lines.push(`-- ---------- 视图: ${v} ----------`)
      lines.push(`DROP VIEW IF EXISTS ${qi(v)};`)
      lines.push(ddl + ';')
      lines.push('')
    } catch (e) {
      lines.push(`-- 导出视图 ${v} 失败: ${e.message}`, '')
    }
  }

  lines.push('SET FOREIGN_KEY_CHECKS = 1;', '', `-- 导出完成（${totalRows} 行数据）`)

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
  shell.showItemInFolder(filePath)
  return { ok: true, path: filePath, tables: tables.length, views: views.length, rows: totalRows }
})

ipcMain.handle('db:pickSqlFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'SQL', extensions: ['sql'] }]
  })
  return canceled ? null : filePaths[0]
})

ipcMain.handle('db:importSql', async (_e, connId, database, filePath) => {
  const { pool } = await getPool(connId)
  const sqlText = fs.readFileSync(filePath, 'utf8')
  const conn = await pool.getConnection()
  try {
    if (database) await conn.query(`USE ${qi(database)}`)
    const start = Date.now()
    // 按分号拆分统计（跳过注释行）
    const statements = sqlText
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s && !/^(--|#)/.test(s) && !/^\/\*/.test(s))
    const [results] = await conn.query(sqlText)
    const elapsed = (Date.now() - start) / 1000
    return { ok: true, statements: statements.length, elapsed }
  } catch (err) {
    return { ok: false, error: err.message }
  } finally {
    conn.release()
  }
})

// ============ 数据字典 ============
async function collectDictionary(pool, database) {
  const [tables] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment, ENGINE AS engine,
            TABLE_COLLATION AS collation, TABLE_ROWS AS rowsEst, CREATE_TIME AS createTime
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [database]
  )
  const [columns] = await pool.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type,
            IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey,
            EXTRA AS extra, COLUMN_COMMENT AS comment, ORDINAL_POSITION AS pos
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database]
  )
  const [indexes] = await pool.query(
    `SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
            SEQ_IN_INDEX AS seq, COLUMN_NAME AS colName, INDEX_TYPE AS type
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database]
  )
  const [fks] = await pool.query(
    `SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS colName,
            k.REFERENCED_TABLE_NAME AS refTable, k.REFERENCED_COLUMN_NAME AS refColumn,
            r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME`,
    [database]
  )

  // 按表聚合
  return tables.map((t) => ({
    name: t.name,
    comment: t.comment || '',
    engine: t.engine,
    collation: t.collation,
    rowsEst: t.rowsEst,
    createTime: t.createTime ? String(t.createTime).slice(0, 19) : '',
    columns: columns
      .filter((c) => c.tableName === t.name)
      .map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === 'YES',
        defaultValue: c.defaultValue === undefined ? null : c.defaultValue,
        key: c.columnKey || '',
        extra: c.extra || '',
        comment: c.comment || ''
      })),
    indexes: indexes.filter((i) => i.tableName === t.name),
    foreignKeys: fks.filter((f) => f.tableName === t.name)
  }))
}

ipcMain.handle('db:dataDictionary', async (_e, connId, database) => {
  const { pool } = await getPool(connId)
  return collectDictionary(pool, database)
})

// 生成 Markdown
function dictToMarkdown(database, dict) {
  const lines = [`# ${database} 数据字典`, '', `生成时间：${new Date().toLocaleString('zh-CN')}`, `表数量：${dict.length}`, '', '## 目录', '']
  dict.forEach((t, i) => lines.push(`${i + 1}. [${t.name}](#${t.name.toLowerCase()})${t.comment ? ' — ' + t.comment : ''}`))
  lines.push('', '---', '')
  dict.forEach((t) => {
    lines.push(`## ${t.name}`, '')
    if (t.comment) lines.push(`> ${t.comment}`, '')
    lines.push(`- 引擎：${t.engine || '-'}`)
    lines.push(`- 字符集：${t.collation || '-'}`)
    lines.push(`- 预估行数：${t.rowsEst ?? '-'}`)
    if (t.createTime) lines.push(`- 创建时间：${t.createTime}`)
    lines.push('', '| 字段 | 类型 | 可空 | 键 | 默认值 | 说明 |', '|---|---|---|---|---|---|')
    t.columns.forEach((c) => {
      const key = c.key === 'PRI' ? '🔑 主键' : c.key === 'UNI' ? '唯一' : c.key === 'MUL' ? '索引' : ''
      lines.push(`| ${c.name} | ${c.type} | ${c.nullable ? 'YES' : 'NO'} | ${key} | ${c.defaultValue === null ? 'NULL' : c.defaultValue} | ${c.comment} |`)
    })
    lines.push('')
    if (t.foreignKeys.length) {
      lines.push('**外键**', '', '| 约束 | 列 | 引用 | ON DELETE | ON UPDATE |', '|---|---|---|---|---|')
      t.foreignKeys.forEach((f) => lines.push(`| ${f.name} | ${f.colName} | ${f.refTable}.${f.refColumn} | ${f.onDelete} | ${f.onUpdate} |`))
      lines.push('')
    }
    lines.push('---', '')
  })
  return lines.join('\n')
}

// 生成自包含 HTML
function dictToHtml(database, dict) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))
  const toc = dict.map((t, i) => `<li><a href="#t${i}">${esc(t.name)}</a>${t.comment ? ' <span class="cmt">' + esc(t.comment) + '</span>' : ''}</li>`).join('\n')
  const sections = dict.map((t, i) => {
    const cols = t.columns.map((c) => {
      const key = c.key === 'PRI' ? '<span class="pk">🔑 PK</span>' : c.key === 'UNI' ? '<span class="uni">UNIQUE</span>' : c.key === 'MUL' ? '<span class="mul">INDEX</span>' : ''
      return `<tr>
        <td class="mono strong">${esc(c.name)}</td>
        <td class="mono type">${esc(c.type)}</td>
        <td>${c.nullable ? 'YES' : 'NO'}</td>
        <td>${key}</td>
        <td class="mono">${c.defaultValue === null ? '<i class="null">NULL</i>' : esc(c.defaultValue)}</td>
        <td class="mono muted">${esc(c.extra)}</td>
        <td>${esc(c.comment)}</td>
      </tr>`
    }).join('\n')
    const fk = t.foreignKeys.length
      ? `<h4>外键</h4><table class="fk"><thead><tr><th>约束名</th><th>列</th><th>引用</th><th>ON DELETE</th><th>ON UPDATE</th></tr></thead><tbody>${
          t.foreignKeys.map((f) => `<tr><td class="mono">${esc(f.name)}</td><td class="mono">${esc(f.colName)}</td><td class="mono ref">${esc(f.refTable)}.${esc(f.refColumn)}</td><td>${esc(f.onDelete)}</td><td>${esc(f.onUpdate)}</td></tr>`).join('')
        }</tbody></table>`
      : ''
    const idx = t.indexes.length
      ? `<h4>索引</h4><table class="fk"><thead><tr><th>索引名</th><th>列</th><th>唯一</th><th>类型</th></tr></thead><tbody>${
          t.indexes.map((x) => `<tr><td class="mono">${esc(x.name)}</td><td class="mono">${esc(x.colName)}</td><td>${x.nonUnique ? 'NO' : 'YES'}</td><td>${esc(x.type)}</td></tr>`).join('')
        }</tbody></table>`
      : ''
    return `<section id="t${i}">
      <h2>${esc(t.name)}${t.comment ? ' <span class="cmt">' + esc(t.comment) + '</span>' : ''}</h2>
      <div class="meta">
        <span>引擎 <b>${esc(t.engine || '-')}</b></span>
        <span>字符集 <b>${esc(t.collation || '-')}</b></span>
        <span>预估行数 <b>${t.rowsEst ?? '-'}</b></span>
        ${t.createTime ? `<span>创建时间 <b>${esc(t.createTime)}</b></span>` : ''}
      </div>
      <table class="cols"><thead><tr><th>字段</th><th>类型</th><th>可空</th><th>键</th><th>默认值</th><th>Extra</th><th>注释</th></tr></thead><tbody>${cols}</tbody></table>
      ${fk}${idx}
    </section>`
  }).join('\n')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(database)} 数据字典</title>
<style>
  :root { --bg:#fff; --fg:#1a1a22; --muted:#8f8f9d; --line:#e5e5ec; --accent:#7c5cfc; --surface:#f8f8fb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#101014; --fg:#ededf2; --muted:#62626e; --line:#26262e; --surface:#17171c; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 48px; font: 14px/1.6 -apple-system, "PingFang SC", sans-serif; color:var(--fg); background:var(--bg); }
  h1 { font-size:28px; margin:0 0 8px; } h2 { font-size:20px; margin:36px 0 10px; padding-bottom:6px; border-bottom:2px solid var(--accent); }
  h4 { font-size:14px; margin:20px 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.5px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:24px; }
  .cmt { color:var(--muted); font-weight:400; font-size:13px; }
  nav { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 24px; margin-bottom:32px; }
  nav ol { margin:0; padding-left:20px; columns:2; } nav li { margin:3px 0; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  .meta { display:flex; flex-wrap:wrap; gap:18px; margin:8px 0 14px; font-size:13px; color:var(--muted); }
  .meta b { color:var(--fg); font-weight:600; }
  table { border-collapse:collapse; width:100%; margin-bottom:8px; font-size:13px; }
  th { text-align:left; background:var(--surface); font-weight:650; }
  th,td { padding:7px 12px; border:1px solid var(--line); }
  .cols td:first-child { width:160px; } .mono { font-family:"SF Mono",Menlo,monospace; font-size:12px; }
  .strong { font-weight:600; } .type { color:var(--accent); } .muted { color:var(--muted); }
  .null { color:var(--muted); } .ref { color:#4ea8ff; }
  .pk { color:#f5b942; font-weight:600; } .uni { color:#3dd68c; font-weight:600; } .mul { color:#4ea8ff; font-weight:600; }
  .fk td:first-child { width:220px; }
  footer { margin-top:48px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
</style></head><body>
<h1>${esc(database)} 数据字典</h1>
<div class="sub">生成时间：${new Date().toLocaleString('zh-CN')} · 表数量：${dict.length} · 由 MySQLStudio 生成</div>
<nav><ol>${toc}</ol></nav>
${sections}
<footer>MySQLStudio · 数据字典 · ${esc(database)}</footer>
</body></html>`
}

ipcMain.handle('db:exportDictionary', async (_e, connId, database, format) => {
  const { pool } = await getPool(connId)
  const dict = await collectDictionary(pool, database)
  const ext = format === 'md' ? 'md' : format === 'csv' ? 'csv' : 'html'
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${database}.数据字典.${ext}`,
    filters: [{ name: format.toUpperCase(), extensions: [ext] }]
  })
  if (canceled || !filePath) return { canceled: true }

  let content
  if (format === 'md') content = dictToMarkdown(database, dict)
  else if (format === 'csv') {
    const rows = [['表名', '表注释', '字段', '类型', '可空', '键', '默认值', 'Extra', '字段注释']]
    dict.forEach((t) => t.columns.forEach((c) => rows.push([t.name, t.comment, c.name, c.type, c.nullable ? 'YES' : 'NO', c.key, c.defaultValue ?? 'NULL', c.extra, c.comment])))
    const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    content = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')
  } else content = dictToHtml(database, dict)

  fs.writeFileSync(filePath, content, 'utf8')
  shell.showItemInFolder(filePath)
  return { ok: true, path: filePath, tables: dict.length }
})

// ============ 窗口 ============
function createWindow() {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#101014',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 14, y: 16 },
          vibrancy: 'sidebar',
          visualEffectState: 'active'
        }
      : {
          // Windows：隐藏原生标题栏，由系统把最小化/最大化/关闭按钮叠加在自定义标题栏右侧
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#17171c', symbolColor: '#ededf2', height: 46 }
        }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// Windows 标题栏按钮颜色跟随应用主题
ipcMain.on('win:titlebar-theme', (e, theme) => {
  if (process.platform === 'darwin') return
  const w = BrowserWindow.fromWebContents(e.sender)
  if (!w) return
  const dark = theme !== 'light'
  try {
    w.setTitleBarOverlay({
      color: dark ? '#17171c' : '#ffffff',
      symbolColor: dark ? '#ededf2' : '#1a1a22',
      height: 46
    })
  } catch { /* 旧系统不支持 overlay 时忽略 */ }
})

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.humbert.mysqlstudio')
    Menu.setApplicationMenu(null)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
