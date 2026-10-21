const { contextBridge, ipcRenderer } = require('electron')

// 统一清洗：Vue reactive Proxy 无法通过 structured clone，
// 所有 IPC 参数先转为纯 JSON 值（本项目参数均为简单类型，无 Date/函数）
const clean = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args.map(clean))

const api = {
  platform: process.platform,
  setTitlebarTheme: (theme) => ipcRenderer.send('win:titlebar-theme', theme),
  // 连接配置
  listConfigs: () => invoke('cfg:list'),
  saveConfig: (config) => invoke('cfg:save', config),
  deleteConfig: (id) => invoke('cfg:delete', id),
  // 连接
  connect: (config) => invoke('db:connect', config),
  disconnect: (connId) => invoke('db:disconnect', connId),
  test: (config) => invoke('db:test', config),
  // 元数据
  databases: (connId) => invoke('db:databases', connId),
  tables: (connId, db) => invoke('db:tables', connId, db),
  views: (connId, db) => invoke('db:views', connId, db),
  tableStructure: (connId, db, table) => invoke('db:tableStructure', connId, db, table),
  columns: (connId, db, table) => invoke('db:columns', connId, db, table),
  foreignKeys: (connId, db, table) => invoke('db:foreignKeys', connId, db, table),
  addForeignKey: (connId, db, table, fk) => invoke('db:addForeignKey', connId, db, table, fk),
  dropForeignKey: (connId, db, table, name) => invoke('db:dropForeignKey', connId, db, table, name),
  modifyForeignKey: (connId, db, table, oldName, fk) => invoke('db:modifyForeignKey', connId, db, table, oldName, fk),
  charsets: (connId) => invoke('db:charsets', connId),
  // 数据
  selectPage: (connId, db, table, opts) => invoke('db:selectPage', connId, db, table, opts),
  updateCell: (connId, db, table, pk, col, val) => invoke('db:updateCell', connId, db, table, pk, col, val),
  deleteRow: (connId, db, table, pk) => invoke('db:deleteRow', connId, db, table, pk),
  insertRow: (connId, db, table, values) => invoke('db:insertRow', connId, db, table, values),
  // 库操作
  createDatabase: (connId, name, charset, collation) => invoke('db:createDatabase', connId, name, charset, collation),
  dropDatabase: (connId, name) => invoke('db:dropDatabase', connId, name),
  alterDatabase: (connId, name, charset, collation) => invoke('db:alterDatabase', connId, name, charset, collation),
  // 表操作
  createTable: (connId, db, spec) => invoke('db:createTable', connId, db, spec),
  dropTable: (connId, db, table) => invoke('db:dropTable', connId, db, table),
  truncateTable: (connId, db, table) => invoke('db:truncateTable', connId, db, table),
  renameTable: (connId, db, table, newName) => invoke('db:renameTable', connId, db, table, newName),
  // 结构编辑
  addColumn: (connId, db, table, col) => invoke('db:addColumn', connId, db, table, col),
  modifyColumn: (connId, db, table, oldName, col) => invoke('db:modifyColumn', connId, db, table, oldName, col),
  dropColumn: (connId, db, table, column) => invoke('db:dropColumn', connId, db, table, column),
  renameColumn: (connId, db, table, oldName, newName) => invoke('db:renameColumn', connId, db, table, oldName, newName),
  // SQL
  execute: (connId, db, sql) => invoke('db:execute', connId, db, sql),
  // 导出
  exportTable: (connId, db, table, format) => invoke('db:export', connId, db, table, format),
  exportSql: (connId, db, table, mode) => invoke('db:exportSql', connId, db, table, mode),
  exportDatabase: (connId, db, mode) => invoke('db:exportDatabase', connId, db, mode),
  // 导入
  pickSqlFile: () => invoke('db:pickSqlFile'),
  importSql: (connId, db, filePath) => invoke('db:importSql', connId, db, filePath),
  // 数据字典
  dataDictionary: (connId, db) => invoke('db:dataDictionary', connId, db),
  exportDictionary: (connId, db, format) => invoke('db:exportDictionary', connId, db, format)
}

contextBridge.exposeInMainWorld('api', api)
