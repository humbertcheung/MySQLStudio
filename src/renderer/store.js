import { reactive } from 'vue'

export const store = reactive({
  phase: 'disconnected', // disconnected | connected
  connId: null,
  serverVersion: '',
  config: null,
  databases: [],
  currentDb: '',
  tables: [],
  views: [],
  currentTable: '',
  tab: 'data', // data | structure | query
  sidebarVisible: true,
  expandedTables: [],
  // 列宽记忆: { 'db.table': { colName: width } }
  columnWidths: JSON.parse(localStorage.getItem('ms-cw') || '{}'),
  tableColumns: {},
  theme: localStorage.getItem('ms-theme') || 'dark',
  sqlHistory: JSON.parse(localStorage.getItem('ms-sqlHistory') || '[]')
})

export function pushHistory(sql) {
  const h = [sql, ...store.sqlHistory.filter((s) => s !== sql)].slice(0, 100)
  store.sqlHistory = h
  localStorage.setItem('ms-sqlHistory', JSON.stringify(h))
}

export function setTheme(t) {
  store.theme = t
  localStorage.setItem('ms-theme', t)
}
