<template>
  <div class="query-root">
    <div class="editor-wrap" ref="editorEl" />

    <!-- 执行工具条 -->
    <div class="run-bar">
      <n-select
        v-model:value="store.currentDb"
        :options="dbOptions"
        size="small"
        filterable
        placeholder="数据库"
        style="width: 170px"
        title="当前数据库（切换后侧栏同步）"
      />
      <n-button size="small" type="primary" :loading="running" @click="run">
        <template #icon><n-icon :component="Play16Filled" /></template>
        执行
      </n-button>
      <span class="shortcut-hint">⌘ + Enter</span>
      <n-button size="small" quaternary @click="clearEditor" title="清空编辑器">
        <template #icon><n-icon :component="Broom16Regular" /></template>
      </n-button>
      <div style="flex: 1" />
      <span v-if="lastRun" class="last-run">{{ lastRun }}</span>
    </div>

    <div class="result-area">
      <div class="result-head">
        <n-tag v-if="resultSets.length > 1" size="small" :bordered="false">{{ resultSets.length }} 个结果集</n-tag>
        <div style="flex: 1" />
        <n-button size="tiny" quaternary @click="historyShow = true">
          <template #icon><n-icon :component="History16Regular" /></template>
          历史
        </n-button>
      </div>

      <n-alert v-if="error" type="error" :bordered="false" closable @close="error = ''">
        {{ error }}
      </n-alert>

      <!-- 结果区：统一用 n-tabs（单结果集时隐藏标签头） -->
      <!-- 结果集切换（自绘，仅多结果集时显示） -->
      <div v-if="resultSets.length > 1" class="set-tabs">
        <button
          v-for="(rs, i) in resultSets"
          :key="'setbtn' + i"
          :class="{ active: activeSet === String(i) }"
          @click="activeSet = String(i)"
        >
          {{ setLabel(rs, i) }}
        </button>
      </div>

      <!-- 结果内容 -->
      <div class="result-body">
        <RsView v-if="activeSetRs" :rs="activeSetRs" />
        <div v-if="!activeSetRs" class="rs-placeholder">⌘ + Enter 执行 SQL</div>
      </div>
    </div>

    <n-drawer v-model:show="historyShow" :width="440" placement="right">
      <n-drawer-content title="SQL 历史" closable>
        <div v-if="!store.sqlHistory.length" style="color: var(--text-tertiary); text-align: center; padding: 30px 0">
          暂无历史
        </div>
        <div v-for="(s, i) in store.sqlHistory" :key="i" class="history-item" @click="useHistory(s)">
          <pre>{{ s }}</pre>
        </div>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import { NTabs, NTabPane, NAlert, NTag, NButton, NIcon, NDrawer, NDrawerContent, NSelect, useMessage } from 'naive-ui'
import { History16Regular, Play16Filled, Broom16Regular } from '@vicons/fluent'
import { store, pushHistory } from '../store'
import RsView from './RsView.vue'

const message = useMessage()
const editorEl = ref(null)
let editor = null

const dbOptions = computed(() => store.databases.map((d) => ({ label: d, value: d })))

// ============ Monaco SQL 自动补全 ============
const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'ALL', 'AS',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'OUTER JOIN',
  'ON', 'USING', 'UNION', 'UNION ALL',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'REPLACE INTO',
  'CREATE TABLE', 'CREATE DATABASE', 'CREATE INDEX', 'CREATE VIEW',
  'ALTER TABLE', 'ADD COLUMN', 'DROP COLUMN', 'MODIFY COLUMN', 'CHANGE COLUMN',
  'DROP TABLE', 'DROP DATABASE', 'DROP INDEX', 'DROP VIEW', 'TRUNCATE TABLE',
  'PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'INDEX', 'KEY',
  'NOT NULL', 'NULL', 'DEFAULT', 'AUTO_INCREMENT', 'CHECK', 'REFERENCES',
  'CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION',
  'IF EXISTS', 'IF NOT EXISTS', 'EXISTS', 'BETWEEN', 'IS NULL', 'IS NOT NULL', 'LIKE',
  'AND', 'OR', 'IN', 'NOT IN', 'ANY', 'ALL',
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL',
  'VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT', 'BLOB',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN', 'BOOL', 'JSON', 'ENUM', 'SET',
  'ASC', 'DESC', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'GROUP_CONCAT',
  'IFNULL', 'COALESCE', 'NULLIF', 'CASE WHEN', 'THEN', 'ELSE', 'END',
  'CONCAT', 'SUBSTRING', 'LENGTH', 'LOWER', 'UPPER', 'TRIM', 'REPLACE', 'NOW', 'CURDATE', 'DATE_FORMAT',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'START TRANSACTION', 'USE'
]

const SQL_SNIPPETS = [
  { label: 'SELECT', body: ['SELECT ${1:*}', 'FROM ${2:table}', 'WHERE ${3:1=1}', 'LIMIT ${4:100};'], detail: 'SELECT 查询模板' },
  { label: 'INSERT', body: ['INSERT INTO ${1:table} (${2:cols})', 'VALUES (${3:values});'], detail: 'INSERT 模板' },
  { label: 'UPDATE', body: ['UPDATE ${1:table}', 'SET ${2:col} = ${3:value}', 'WHERE ${4:id} = ${5:1};'], detail: 'UPDATE 模板' },
  { label: 'DELETE', body: ['DELETE FROM ${1:table}', 'WHERE ${2:1=1};'], detail: 'DELETE 模板' },
  { label: 'CREATE TABLE', body: ['CREATE TABLE ${1:table} (', '  $0', ');'], detail: 'CREATE TABLE 模板' },
  { label: 'ALTER ADD', body: ['ALTER TABLE ${1:table}', 'ADD COLUMN ${2:col} ${3:type};'], detail: '添加列' },
  { label: 'COUNT', body: ['SELECT COUNT(*) FROM ${1:table} WHERE ${2:1=1};'], detail: '统计行数' },
  { label: 'JOIN', body: ['SELECT *', 'FROM ${1:a}', 'JOIN ${2:b} ON ${3:a.id} = ${4:b.a_id}', 'WHERE ${5:1=1};'], detail: 'INNER JOIN 模板' }
]

const tblCache = ref({ databases: [], tables: {}, columns: {} })

async function refreshSqlCompletions() {
  try {
    tblCache.value.databases = await window.api.databases(store.connId)
    if (store.currentDb) {
      tblCache.value.tables[store.currentDb] = await window.api.tables(store.connId, store.currentDb)
    }
    if (store.currentTable) {
      tblCache.value.columns[`${store.currentDb}.${store.currentTable}`] = (
        await window.api.columns(store.connId, store.currentDb, store.currentTable)
      ).map((c) => c.name)
    }
  } catch {}
}

watch(() => [store.connId, store.currentDb, store.currentTable], refreshSqlCompletions, { immediate: true })

function registerSqlCompletion() {
  monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '.', '`'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(
        position.lineNumber, word.startColumn,
        position.lineNumber, word.endColumn
      )
      const suggestions = []

      // 关键字
      for (const kw of SQL_KEYWORDS) {
        if (!word.word || kw.toLowerCase().startsWith(word.word.toLowerCase())) {
          suggestions.push({
            label: kw, kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw, range
          })
        }
      }

      // snippets
      for (const sn of SQL_SNIPPETS) {
        if (!word.word || sn.label.toLowerCase().startsWith(word.word.toLowerCase())) {
          suggestions.push({
            label: { label: sn.label, description: sn.detail },
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: sn.body.join('\n'), insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            documentation: { value: sn.body.join('\n') },
            range
          })
        }
      }

      // 表
      const tables = store.table?.length ? tblCache.value.tables[store.currentDb] || [] : []
      for (const t of tables) {
        if (!word.word || t.toLowerCase().startsWith(word.word.toLowerCase())) {
          suggestions.push({
            label: t, kind: monaco.languages.CompletionItemKind.Class,
            insertText: t, detail: '表', range
          })
        }
      }

      // 列
      const cols = store.currentTable ? tblCache.value.columns[`${store.currentDb}.${store.currentTable}`] || [] : []
      for (const c of cols) {
        if (!word.word || c.toLowerCase().startsWith(word.word.toLowerCase())) {
          suggestions.push({
            label: c, kind: monaco.languages.CompletionItemKind.Field,
            insertText: c, detail: '列', range
          })
        }
      }

      // 数据库
      for (const db of tblCache.value.databases || []) {
        if (!word.word || db.toLowerCase().startsWith(word.word.toLowerCase())) {
          suggestions.push({
            label: db, kind: monaco.languages.CompletionItemKind.Module,
            insertText: db, detail: '数据库', range
          })
        }
      }

      return { suggestions }
    }
  })
}



const resultSets = ref([])
const activeSet = ref('0')
const activeSetRs = computed(() => resultSets.value[Number(activeSet.value)] || null)
const error = ref('')
const lastRun = ref('')
const historyShow = ref(false)
const running = ref(false)

onMounted(() => {
  editor = monaco.editor.create(editorEl.value, {
    value: store.sqlHistory[0] || 'SELECT 1',
    language: 'sql',
    theme: effectiveDark() ? 'vs-dark' : 'vs',
    fontSize: 13,
    fontFamily: "'SF Mono', ui-monospace, Menlo, monospace",
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    padding: { top: 12 },
    renderLineHighlight: 'none',
    overviewRulerLanes: 0
  })
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run)
  registerSqlCompletion()
})

function effectiveDark() {
  return document.documentElement.classList.contains('theme-dark')
}

watch(() => store.theme, () => monaco.editor.setTheme(effectiveDark() ? 'vs-dark' : 'vs'))

function setLabel(rs, i) {
  if (rs.columns.length) return `结果 ${i + 1}（${rs.rows.length} 行）`
  return `语句 ${i + 1}（影响 ${rs.affected} 行）`
}

function clearEditor() {
  editor.setValue('')
}

async function run() {
  const sql = editor.getValue().trim()
  if (!sql) return
  running.value = true
  const res = await window.api.execute(store.connId, store.currentDb || null, sql)
  running.value = false
  if (!res.ok) {
    error.value = res.error
    resultSets.value = []
    lastRun.value = ''
    return
  }
  error.value = ''
  resultSets.value = res.statements
  activeSet.value = '0'
  lastRun.value = `成功 · ${res.elapsed.toFixed(3)}s`
  pushHistory(sql)
}

function useHistory(s) {
  editor.setValue(s)
  historyShow.value = false
}
</script>

<style scoped>
.query-root { height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.editor-wrap {
  height: 34%;
  min-height: 150px;
  flex-shrink: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  overflow: hidden;
  background: var(--bg-surface);
}
.run-bar { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.shortcut-hint { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }
.last-run { font-size: 12px; color: var(--success-text); font-family: var(--font-mono); }
.result-area { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.result-head { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.result-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.set-tabs { display: flex; gap: 4px; flex-shrink: 0; flex-wrap: wrap; }
.set-tabs button {
  border: none; background: var(--bg-hover); color: var(--text-secondary);
  font-size: 12px; padding: 3px 12px; border-radius: 6px; cursor: pointer;
  font-family: var(--font-ui); transition: all .15s;
}
.set-tabs button:hover { color: var(--text-primary); }
.set-tabs button.active { background: var(--accent-subtle); color: var(--accent-text); font-weight: 600; }
.rs-placeholder {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--text-tertiary); font-size: 13px;
}
.history-item {
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  margin-bottom: 8px;
  cursor: pointer;
}
.history-item:hover { border-color: var(--accent-solid); }
.history-item pre {
  margin: 0; font-family: var(--font-mono); font-size: 12px;
  white-space: pre-wrap; word-break: break-all; color: var(--text-primary);
}
</style>
