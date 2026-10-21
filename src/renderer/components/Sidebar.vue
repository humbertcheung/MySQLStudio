<template>
  <aside class="side">
    <!-- 数据库 -->
    <div class="side-section">
      <div class="side-label">
        数据库
        <n-tag v-if="store.databases.length" size="tiny" :bordered="false" round>{{ store.databases.length }}</n-tag>
        <div style="flex: 1" />
        <n-button quaternary size="tiny" title="刷新连接（重新获取数据库列表）" @click="refreshAll" :loading="refreshing">
          <template #icon><n-icon :component="ArrowClockwise16Regular" /></template>
        </n-button>
        <n-dropdown :options="dbExportOptions" @select="doExportDatabase" :disabled="!store.currentDb">
          <n-button quaternary size="tiny" title="导出整个数据库（.sql）" :disabled="!store.currentDb">
            <template #icon><n-icon :component="ArrowExportLtr16Regular" /></template>
          </n-button>
        </n-dropdown>
        <n-button quaternary size="tiny" title="新建数据库" @click="dbModalRef?.open()">
          <template #icon><n-icon :component="Add16Regular" /></template>
        </n-button>
      </div>
      <n-scrollbar class="db-list">
        <div
          v-for="db in store.databases"
          :key="db"
          class="db-item"
          :class="{ active: db === store.currentDb }"
          @click="store.currentDb = db"
          @contextmenu.prevent="showDbMenu($event, db)"
        >
          <n-icon :component="Database20Regular" size="13" class="db-icon" />
          <span class="db-name">{{ db }}</span>
        </div>
        <div v-if="!store.databases.length" class="no-obj">无数据库</div>
      </n-scrollbar>
    </div>

    <!-- 数据库右键菜单 -->
    <n-dropdown
      placement="bottom-start"
      trigger="manual"
      :x="dbMenuX" :y="dbMenuY"
      :options="dbMenuOptions"
      :show="dbMenuShow"
      @clickoutside="dbMenuShow = false"
      @select="onDbMenu"
    />

    <!-- 编辑数据库弹窗 -->
    <n-modal v-model:show="editDbShow" preset="card" :title="'编辑数据库：' + editDbName" style="width: 440px">
      <n-form label-placement="left" label-width="80" size="medium">
        <n-form-item label="字符集">
          <n-select v-model:value="editDbCharset" :options="charsetOptions" filterable @update:value="onEditCharsetChange" />
        </n-form-item>
        <n-form-item label="排序规则">
          <n-select v-model:value="editDbCollation" :options="editCollationOptions" filterable />
        </n-form-item>
      </n-form>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <n-button @click="editDbShow = false">取消</n-button>
          <n-button type="primary" :loading="editDbSaving" @click="submitEditDb">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 搜索 -->
    <n-input v-model:value="filter" size="small" placeholder="搜索表 / 视图…" clearable>
      <template #prefix><n-icon :component="Search16Regular" /></template>
    </n-input>

    <!-- 表分组 -->
    <div class="side-section grow">
      <div class="side-row-toggle" @click="showTables = !showTables" :title="showTables ? '收起' : '展开'">
        <n-icon size="12" :component="showTables ? ChevronDown16Regular : ChevronRight16Regular" class="toggle-icon" />
        <span class="group-title">表</span>
        <n-tag v-if="filteredTables.length" size="tiny" :bordered="false" round>{{ filteredTables.length }}</n-tag>
        <span style="flex: 1" />
        <n-button size="tiny" quaternary title="新建表" @click.stop="tableModalRef?.open()">
          <template #icon><n-icon size="14" :component="Add16Regular" /></template>
        </n-button>
        <n-button size="tiny" quaternary title="刷新" @click.stop="refresh">
          <template #icon><n-icon size="14" :component="ArrowClockwise16Regular" /></template>
        </n-button>
      </div>

      <n-scrollbar class="obj-list" :style="showTables ? {} : { display: 'none' }">
        <template v-for="t in filteredTables" :key="'t' + t">
          <div
            class="obj-item"
            :class="{ active: t === store.currentTable }"
            @click="openObject(t)"
            @contextmenu.prevent="(e) => showMenu(e, t)"
          >
            <n-button
              quaternary size="tiny" class="expand-btn"
              :title="isExpanded(t) ? '收起字段' : '展开字段'"
              @click.stop="toggleExpand(t)"
            >
              <template #icon>
                <n-icon size="12" :component="isExpanded(t) ? ChevronDown16Regular : ChevronRight16Regular" />
              </template>
            </n-button>
            <n-icon :component="Table16Regular" size="14" class="obj-icon" />
            <span class="obj-name">{{ t }}</span>
          </div>
          <!-- 展开的字段树 -->
          <div v-if="isExpanded(t)" class="col-tree">
            <div v-if="!store.tableColumns[t]" class="col-loading">加载中…</div>
            <div v-for="c in store.tableColumns[t] || []" :key="c.name" class="col-item">
              <n-icon
                v-if="c.isPrimary" :component="Key16Regular" size="12" class="ico-pk" title="主键"
              />
              <n-icon
                v-else-if="c.isForeign" :component="Link16Regular" size="12" class="ico-fk" title="外键"
              />
              <span v-else class="col-dot" />
              <span class="col-name">{{ c.name }}</span>
              <span class="col-type">{{ shortType(c.type) }}</span>
            </div>
          </div>
        </template>
        <div v-if="!filteredTables.length" class="no-obj">无表</div>
      </n-scrollbar>
    </div>

    <!-- 视图分组 -->
    <div class="side-section" style="max-height: 32%">
      <div class="side-label">
        <n-button quaternary size="tiny" :title="showViews ? '收起' : '展开'" @click="showViews = !showViews">
          <template #icon><n-icon :component="showViews ? ChevronDown16Regular : ChevronRight16Regular" /></template>
        </n-button>
        <span class="group-title" @click="showViews = !showViews">视图</span>
        <n-tag v-if="filteredViews.length" size="tiny" :bordered="false" round>{{ filteredViews.length }}</n-tag>
        <div style="flex: 1" />
        <n-button quaternary size="tiny" title="刷新视图" @click="refreshViews">
          <template #icon><n-icon :component="ArrowClockwise16Regular" /></template>
        </n-button>
      </div>
      <n-scrollbar class="obj-list" :style="showViews ? {} : { display: 'none' }">
        <div
          v-for="v in filteredViews"
          :key="'v' + v"
          class="obj-item"
          :class="{ active: v === store.currentTable }"
          @click="openObject(v)"
          @contextmenu.prevent="(e) => showMenu(e, v, true)"
        >
          <span class="expand-placeholder" />
          <n-icon :component="Eye16Regular" size="14" class="obj-icon view-icon" />
          <span class="obj-name">{{ v }}</span>
        </div>
        <div v-if="!filteredViews.length" class="no-obj">无视图</div>
      </n-scrollbar>
    </div>

    <!-- 右键菜单 -->
    <n-dropdown
      placement="bottom-start"
      trigger="manual"
      :x="menuX" :y="menuY"
      :options="menuOptions"
      :show="menuShow"
      @clickoutside="menuShow = false"
      @select="onMenu"
    />

    <CreateDatabaseModal ref="dbModalRef" @created="onDbCreated" />
    <CreateTableModal ref="tableModalRef" :database="store.currentDb" @created="refresh" />
  </aside>
</template>

<script setup>
import { computed, h, ref, watch } from 'vue'
import {
  NSelect, NInput, NButton, NIcon, NScrollbar, NTag, NDropdown, NModal, NForm, NFormItem,
  useMessage, useDialog
} from 'naive-ui'
import {
  Add16Regular, ArrowClockwise16Regular, Search16Regular, Table16Regular, Eye16Regular,
  ChevronDown16Regular, ChevronRight16Regular, Delete16Regular, List16Regular,
  Edit16Regular, Broom16Regular, TableSimple16Regular, Key16Regular, Link16Regular,
  ArrowExportLtr16Regular, DocumentArrowDown16Regular, Database20Regular
} from '@vicons/fluent'
import { store } from '../store'
import CreateDatabaseModal from './CreateDatabaseModal.vue'
import CreateTableModal from './CreateTableModal.vue'

const message = useMessage()
const dialog = useDialog()

const dbModalRef = ref(null)
const tableModalRef = ref(null)

const filter = ref('')
const showTables = ref(true)
const showViews = ref(true)
const refreshing = ref(false)

// ---------- 刷新连接 ----------
async function refreshAll() {
  if (!store.connId) return
  refreshing.value = true
  try {
    store.databases = await window.api.databases(store.connId)
    if (!store.databases.includes(store.currentDb)) {
      store.currentDb = store.databases[0] || ''
    }
    await Promise.all([refresh(), refreshViews()])
    message.success('已刷新连接')
  } catch (e) {
    message.error('刷新失败：' + e.message)
  } finally {
    refreshing.value = false
  }
}

// ---------- 数据库右键菜单 ----------
const dbMenuShow = ref(false)
const dbMenuX = ref(0)
const dbMenuY = ref(0)
const dbMenuTarget = ref('')

const dbMenuOptions = [
  { label: '刷新（获取最新表）', key: 'refresh', icon: () => h(NIcon, null, () => h(ArrowClockwise16Regular)) },
  { label: '编辑（字符集 / 排序规则）', key: 'edit', icon: () => h(NIcon, null, () => h(Edit16Regular)) },
  { type: 'divider', key: 'd1' },
  {
    label: '删除数据库', key: 'drop',
    icon: () => h(NIcon, { color: '#F04438' }, () => h(Delete16Regular)),
    props: { style: { color: '#F04438' } }
  }
]

function showDbMenu(e, db) {
  dbMenuTarget.value = db
  dbMenuX.value = e.clientX
  dbMenuY.value = e.clientY
  dbMenuShow.value = true
}

async function onDbMenu(key) {
  dbMenuShow.value = false
  const db = dbMenuTarget.value
  if (key === 'refresh') {
    await refreshAll()
  } else if (key === 'edit') {
    await openEditDb(db)
  } else if (key === 'drop') {
    dialog.error({
      title: '删除数据库',
      content: `确定删除数据库 ${db}？其中所有表和数据将永久删除，不可恢复。`,
      positiveText: '删除', negativeText: '取消',
      async onPositiveClick() {
        try {
          await window.api.dropDatabase(store.connId, db)
          message.success(`已删除 ${db}`)
          if (store.currentDb === db) store.currentDb = ''
          await refreshAll()
        } catch (e) { message.error(e.message) }
      }
    })
  }
}

// ---------- 编辑数据库 ----------
const editDbShow = ref(false)
const editDbName = ref('')
const editDbCharset = ref('utf8mb4')
const editDbCollation = ref('')
const editDbSaving = ref(false)
const charsets = ref([])
const collations = ref([])

const charsetOptions = computed(() => charsets.value.map((c) => ({ label: c.name, value: c.name })))
const editCollationOptions = computed(() =>
  collations.value
    .filter((c) => c.charset === editDbCharset.value)
    .map((c) => ({ label: c.name + (c.isDefault ? '（默认）' : ''), value: c.name }))
)

function onEditCharsetChange(v) {
  const def = collations.value.find((c) => c.charset === v && c.isDefault)
  if (def) editDbCollation.value = def.name
}

async function openEditDb(db) {
  editDbName.value = db
  editDbShow.value = true
  try {
    if (!charsets.value.length) {
      const res = await window.api.charsets(store.connId)
      charsets.value = res.charsets
      collations.value = res.collations
    }
    const safe = String(db).replace(/'/g, "''")
    const r = await window.api.execute(
      store.connId, null,
      `SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${safe}'`
    )
    if (r.ok && r.statements[0]?.rows?.length) {
      const [cs, co] = r.statements[0].rows[0]
      editDbCharset.value = cs || 'utf8mb4'
      editDbCollation.value = co || ''
    }
  } catch (e) {
    message.error('读取数据库信息失败：' + e.message)
  }
}

async function submitEditDb() {
  editDbSaving.value = true
  try {
    await window.api.alterDatabase(store.connId, editDbName.value, editDbCharset.value, editDbCollation.value)
    message.success(`已更新 ${editDbName.value}`)
    editDbShow.value = false
    await refreshAll()
  } catch (e) {
    message.error(e.message)
  } finally {
    editDbSaving.value = false
  }
}

const filteredTables = computed(() =>
  store.tables.filter((t) => t.toLowerCase().includes(filter.value.toLowerCase()))
)
const filteredViews = computed(() =>
  store.views.filter((v) => v.toLowerCase().includes(filter.value.toLowerCase()))
)

function shortType(type) {
  return String(type).replace(/\(.*\)/, '').slice(0, 12)
}

// ---------- 字段树展开 ----------
function isExpanded(name) {
  return store.expandedTables.includes(name)
}

async function toggleExpand(name) {
  const idx = store.expandedTables.indexOf(name)
  if (idx >= 0) {
    store.expandedTables.splice(idx, 1)
    return
  }
  store.expandedTables.push(name)
  if (!store.tableColumns[name]) {
    try {
      store.tableColumns[name] = await window.api.columns(store.connId, store.currentDb, name)
    } catch (e) {
      message.error('加载字段失败：' + e.message)
      store.tableColumns[name] = []
    }
  }
}

// ---------- 库切换 ----------
// 统一用 watch：无论从侧栏下拉还是查询区的库下拉切换，都会同步刷新表/视图列表
async function onDbChange(db) {
  if (!db) return
  store.currentTable = ''
  store.expandedTables = []
  store.tableColumns = {}
  await Promise.all([refresh(), refreshViews()])
}

watch(
  () => store.currentDb,
  (db, old) => {
    if (db && db !== old) onDbChange(db)
  }
)

async function refresh() {
  if (!store.currentDb) return
  store.tables = await window.api.tables(store.connId, store.currentDb)
}

async function refreshViews() {
  if (!store.currentDb) return
  store.views = await window.api.views(store.connId, store.currentDb)
}

function openObject(name) {
  store.currentTable = name
  store.tab = 'data'
}

// ---------- 右键菜单 ----------
const menuShow = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTarget = ref('')
const menuIsView = ref(false)

// ---- 整个数据库导出 ----
const dbExportOptions = [
  { label: '导出结构（.sql）', key: 'schema', icon: () => h(NIcon, null, () => h(ArrowExportLtr16Regular)) },
  { label: '导出结构 + 数据（.sql）', key: 'full', icon: () => h(NIcon, null, () => h(ArrowExportLtr16Regular)) }
]

async function doExportDatabase(mode) {
  if (!store.currentDb) return
  try {
    const res = await window.api.exportDatabase(store.connId, store.currentDb, mode)
    if (res.ok) {
      message.success(
        `已导出 ${store.currentDb}：${res.tables} 张表 + ${res.views} 个视图` +
        (mode === 'full' ? `，${res.rows} 行数据` : '')
      )
    }
  } catch (e) {
    message.error('导出失败：' + e.message)
  }
}

const menuOptions = computed(() => {
  const items = [
    { label: '查看数据', key: 'data', icon: () => h(NIcon, null, () => h(TableSimple16Regular)) },
    { label: '查看结构', key: 'structure', icon: () => h(NIcon, null, () => h(List16Regular)) },
    { type: 'divider', key: 'd0' },
    { label: '导出结构（.sql）', key: 'export-schema', icon: () => h(NIcon, null, () => h(ArrowExportLtr16Regular)) },
    { label: '导出结构 + 数据（.sql）', key: 'export-full', icon: () => h(NIcon, null, () => h(ArrowExportLtr16Regular)) }
  ]
  if (!menuIsView.value) {
    items.push(
      { type: 'divider', key: 'd1' },
      { label: '重命名', key: 'rename', icon: () => h(NIcon, null, () => h(Edit16Regular)) },
      { label: '清空表', key: 'truncate', icon: () => h(NIcon, null, () => h(Broom16Regular)) },
      {
        label: '删除表', key: 'drop',
        icon: () => h(NIcon, { color: '#F04438' }, () => h(Delete16Regular)),
        props: { style: { color: '#F04438' } }
      }
    )
  }
  return items
})

function showMenu(e, name, isView = false) {
  menuTarget.value = name
  menuIsView.value = isView
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuShow.value = true
  store.currentTable = name
}

async function onMenu(key) {
  menuShow.value = false
  const t = menuTarget.value
  if (key === 'data') openObject(t)
  else if (key === 'structure') { store.currentTable = t; store.tab = 'structure' }
  else if (key === 'export-schema' || key === 'export-full') {
    const mode = key === 'export-schema' ? 'schema' : 'full'
    const res = await window.api.exportSql(store.connId, store.currentDb, t, mode)
    if (res.ok) message.success('已导出：' + res.path)
  } else if (key === 'rename') {
    const name = await askText('重命名表', '新表名', t)
    if (name && name !== t) {
      try {
        await window.api.renameTable(store.connId, store.currentDb, t, name)
        message.success(`已重命名为 ${name}`)
        await refresh()
        if (store.currentTable === t) store.currentTable = name
      } catch (e) { message.error(e.message) }
    }
  } else if (key === 'truncate') {
    dialog.warning({
      title: '清空表',
      content: `确定清空 ${store.currentDb}.${t} 的全部数据？不可恢复。`,
      positiveText: '清空', negativeText: '取消',
      async onPositiveClick() {
        try {
          await window.api.truncateTable(store.connId, store.currentDb, t)
          message.success('已清空')
        } catch (e) { message.error(e.message) }
      }
    })
  } else if (key === 'drop') {
    dialog.error({
      title: '删除表',
      content: `确定删除 ${store.currentDb}.${t}？不可恢复。`,
      positiveText: '删除', negativeText: '取消',
      async onPositiveClick() {
        try {
          await window.api.dropTable(store.connId, store.currentDb, t)
          message.success('已删除')
          if (store.currentTable === t) store.currentTable = ''
          await refresh()
        } catch (e) { message.error(e.message) }
      }
    })
  }
}

function askText(title, placeholder, initial = '') {
  return new Promise((resolve) => {
    const valueRef = ref(initial)
    const d = dialog.create({
      title,
      content: () => h(NInput, {
        defaultValue: initial, placeholder, autofocus: true,
        'onUpdate:value': (v) => (valueRef.value = v),
        onKeydown: (e) => { if (e.key === 'Enter') d.destroy() }
      }),
      positiveText: '确定', negativeText: '取消',
      onPositiveClick: () => resolve(valueRef.value),
      onClose: () => resolve(null),
      onMaskClick: () => resolve(null)
    })
  })
}

function onDbCreated(name) {
  store.databases = [...store.databases, name].sort()
  store.currentDb = name
  onDbChange(name)
}

</script>

<style scoped>
.side {
  width: 250px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  padding: 12px 10px;
  gap: 10px;
  min-height: 0;
}
.side-section { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.side-section.grow { flex: 1; }
.side-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; letter-spacing: 0.4px;
  color: var(--text-tertiary); text-transform: uppercase;
  padding: 0 2px; height: 24px;
}
.side-row-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background .12s, color .12s;
}
.side-row-toggle:hover { background: var(--bg-hover); color: var(--text-secondary); }
.toggle-icon { flex-shrink: 0; }
.group-title { user-select: none; }
/* 数据库列表 */
.db-list { max-height: 148px; flex-shrink: 0; }
.db-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; border-radius: var(--radius-s);
  cursor: pointer; font-size: 13px;
  transition: background .12s;
  color: var(--text-primary);
  user-select: none;
}
.db-item:hover { background: var(--bg-hover); }
.db-item.active { background: var(--accent-subtle); color: var(--accent-text); font-weight: 550; }
.db-icon { opacity: 0.55; flex-shrink: 0; }
.db-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.obj-list { flex: 1; min-height: 60px; }
.obj-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 2px; border-radius: var(--radius-s);
  cursor: pointer; font-size: 13px;
  transition: background .12s;
  color: var(--text-primary);
  user-select: none;
}
.obj-item:hover { background: var(--bg-hover); }
.obj-item.active { background: var(--accent-subtle); color: var(--accent-text); font-weight: 550; }
.obj-icon { opacity: 0.55; flex-shrink: 0; }
.view-icon { color: #4ea8ff; opacity: 0.8; }
.obj-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.expand-btn { flex-shrink: 0; width: 20px; }
.expand-placeholder { width: 20px; flex-shrink: 0; }
.no-obj { text-align: center; color: var(--text-tertiary); font-size: 12.5px; padding: 14px 0; }

/* 字段树 */
.col-tree { padding: 2px 0 4px 26px; }
.col-loading { font-size: 11.5px; color: var(--text-tertiary); padding: 4px 8px; }
.col-item {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 8px; border-radius: var(--radius-s);
  font-size: 12px; cursor: default;
}
.col-item:hover { background: var(--bg-hover); }
.col-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--text-tertiary); opacity: 0.5;
  margin: 0 4px; flex-shrink: 0;
}
.ico-pk { color: #f5b942; flex-shrink: 0; }
.ico-fk { color: #4ea8ff; flex-shrink: 0; }
.col-name { font-family: var(--font-mono); color: var(--text-primary); }
.col-type {
  margin-left: auto; font-size: 10.5px;
  color: var(--text-tertiary); font-family: var(--font-mono);
  flex-shrink: 0;
}
</style>
