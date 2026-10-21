<template>
  <div v-if="!store.currentTable" class="empty-state"><span>从左侧选择一个表</span></div>
  <div v-else class="struct-root">
    <!-- 顶部 -->
    <div class="struct-toolbar">
      <div class="seg">
        <button :class="{ active: tab === 'cols' }" @click="tab = 'cols'">列</button>
        <button :class="{ active: tab === 'idx' }" @click="tab = 'idx'">索引</button>
        <button :class="{ active: tab === 'fk' }" @click="tab = 'fk'">外键</button>
        <button :class="{ active: tab === 'ddl' }" @click="tab = 'ddl'">DDL</button>
      </div>
      <div style="flex: 1" />
      <n-button v-if="tab === 'cols'" size="small" secondary type="primary" @click="openAddCol">
        <template #icon><n-icon :component="Add16Regular" /></template>
        添加列
      </n-button>
      <n-button v-if="tab === 'fk'" size="small" secondary type="primary" @click="openAddFk">
        <template #icon><n-icon :component="Add16Regular" /></template>
        添加外键
      </n-button>
      <n-button size="small" quaternary @click="load" :loading="loading" title="刷新">
        <template #icon><n-icon :component="ArrowClockwise16Regular" /></template>
      </n-button>
    </div>

    <!-- 列 -->
    <div v-if="tab === 'cols'" class="struct-body">
      <table class="tbl">
        <thead>
          <tr>
            <th>字段</th><th>类型</th><th>可空</th><th>键</th>
            <th>默认值</th><th>Extra</th><th>注释</th><th class="op-col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in structure.columns" :key="c.field">
            <td class="mono strong">
              <span class="field-cell">
                <n-icon v-if="c.key === 'PRI'" :component="Key16Regular" size="13" class="ico-pk" title="主键" />
                <n-icon v-else-if="fkColumns.has(c.field)" :component="Link16Regular" size="13" class="ico-fk" title="外键" />
                <span v-else class="field-dot" />
                {{ c.field }}
              </span>
            </td>
            <td class="mono accent">{{ c.type }}</td>
            <td>{{ c.nullable ? 'YES' : 'NO' }}</td>
            <td>
              <n-icon v-if="c.key === 'PRI'" :component="Key16Regular" size="13" class="ico-pk" title="主键" />
              <n-icon v-else-if="c.key === 'UNI'" :component="Link16Regular" size="13" class="ico-uni" title="唯一键" />
              <n-icon v-else-if="c.key === 'MUL'" :component="Link16Regular" size="13" class="ico-fk" title="索引" />
              <span v-else class="muted">—</span>
            </td>
            <td><span v-if="c.default === null" class="null-cell">NULL</span><span v-else class="mono">{{ c.default }}</span></td>
            <td class="muted">{{ c.extra }}</td>
            <td class="muted ellipsis">{{ c.comment }}</td>
            <td class="op-col">
              <n-button size="tiny" quaternary title="编辑" @click="openEditCol(c)">
                <template #icon><n-icon :component="Edit16Regular" /></template>
              </n-button>
              <n-button size="tiny" quaternary title="重命名" @click="renameCol(c)">
                <template #icon><n-icon :component="TextGrammarWand16Regular" /></template>
              </n-button>
              <n-button size="tiny" quaternary type="error" title="删除列" @click="dropCol(c)">
                <template #icon><n-icon :component="Delete16Regular" /></template>
              </n-button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 索引 -->
    <div v-else-if="tab === 'idx'" class="struct-body">
      <table class="tbl">
        <thead>
          <tr><th>索引名</th><th>列</th><th>序号</th><th>唯一</th><th>类型</th><th>基数</th></tr>
        </thead>
        <tbody>
          <tr v-for="(i, k) in structure.indexes" :key="k">
            <td class="mono strong">{{ i.name }}</td>
            <td class="mono">{{ i.column }}</td>
            <td>{{ i.seq }}</td>
            <td>{{ i.nonUnique ? 'NO' : 'YES' }}</td>
            <td class="muted">{{ i.type }}</td>
            <td class="muted">{{ i.cardinality }}</td>
          </tr>
          <tr v-if="!structure.indexes.length"><td colspan="6" class="empty-row">无索引</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 外键 -->
    <div v-else-if="tab === 'fk'" class="struct-body">
      <table class="tbl">
        <thead>
          <tr><th>约束名</th><th>列</th><th>引用</th><th>ON UPDATE</th><th>ON DELETE</th><th class="op-col">操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="fk in foreignKeys" :key="fk.name">
            <td class="mono strong">{{ fk.name }}</td>
            <td class="mono">{{ fk.columnName }}</td>
            <td class="mono accent">
              {{ fk.refTable }}.{{ fk.refColumn }}
              <span v-if="fk.refSchema !== store.currentDb" class="muted">（{{ fk.refSchema }}）</span>
            </td>
            <td class="muted">{{ fk.onUpdate }}</td>
            <td class="muted">{{ fk.onDelete }}</td>
            <td class="op-col">
              <n-button size="tiny" quaternary title="编辑" @click="openEditFk(fk)">
                <template #icon><n-icon :component="Edit16Regular" /></template>
              </n-button>
              <n-button size="tiny" quaternary type="error" title="删除外键" @click="dropFk(fk)">
                <template #icon><n-icon :component="Delete16Regular" /></template>
              </n-button>
            </td>
          </tr>
          <tr v-if="!foreignKeys.length"><td colspan="6" class="empty-row">无外键约束</td></tr>
        </tbody>
      </table>
    </div>

    <!-- DDL -->
    <div v-else class="struct-body ddl-body">
      <n-button size="tiny" secondary style="position: absolute; top: 12px; right: 24px; z-index: 2" @click="copyDdl">
        复制
      </n-button>
      <pre class="ddl-code">{{ structure.ddl }}</pre>
    </div>

    <!-- 列编辑弹窗 -->
    <n-modal v-model:show="colModalShow" preset="card" :title="colModalTitle" style="width: 520px">
      <n-form label-placement="left" label-width="80" size="medium">
        <n-form-item label="列名">
          <n-input v-model:value="colForm.name" :disabled="colForm.mode === 'edit'" />
        </n-form-item>
        <n-form-item label="类型">
          <div style="display: flex; gap: 8px; width: 100%">
            <n-select v-model:value="colForm.type" :options="typeOptions" filterable style="flex: 1" />
            <n-input v-model:value="colForm.length" placeholder="长度" style="width: 110px" />
          </div>
        </n-form-item>
        <n-form-item label="选项">
          <div style="display: flex; gap: 20px">
            <n-checkbox v-model:checked="colForm.nullable">可空</n-checkbox>
            <n-checkbox v-model:checked="colForm.autoIncrement">自增</n-checkbox>
          </div>
        </n-form-item>
        <n-form-item label="默认值">
          <n-input v-model:value="colForm.defaultValue" placeholder="留空 = 无默认值" />
        </n-form-item>
        <n-form-item label="注释">
          <n-input v-model:value="colForm.comment" />
        </n-form-item>
        <n-form-item v-if="colForm.mode === 'add'" label="位置">
          <n-select v-model:value="colForm.after" :options="afterOptions" placeholder="末尾" clearable />
        </n-form-item>
      </n-form>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <n-button @click="colModalShow = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submitCol">保存</n-button>
        </div>
      </template>
    </n-modal>

    <!-- 外键弹窗 -->
    <n-modal v-model:show="fkModalShow" preset="card" :title="fkModalTitle" style="width: 560px">
      <n-form label-placement="left" label-width="90" size="medium">
        <n-form-item label="本表列">
          <n-select v-model:value="fkForm.column" :options="ownColumnOptions" filterable placeholder="选择列" />
        </n-form-item>
        <n-form-item label="引用表">
          <n-select
            v-model:value="fkForm.refTable"
            :options="refTableOptions"
            filterable
            placeholder="选择被引用的表"
            @update:value="onRefTableChange"
          />
        </n-form-item>
        <n-form-item label="引用列">
          <n-select
            v-model:value="fkForm.refColumn"
            :options="refColumnOptions"
            filterable
            placeholder="选择被引用的列"
            :disabled="!fkForm.refTable"
          />
        </n-form-item>
        <n-form-item label="ON DELETE">
          <n-select v-model:value="fkForm.onDelete" :options="ruleOptions" />
        </n-form-item>
        <n-form-item label="ON UPDATE">
          <n-select v-model:value="fkForm.onUpdate" :options="ruleOptions" />
        </n-form-item>
        <n-form-item label="约束名">
          <n-input v-model:value="fkForm.name" placeholder="留空自动生成" />
        </n-form-item>
      </n-form>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <n-button @click="fkModalShow = false">取消</n-button>
          <n-button type="primary" :loading="saving" :disabled="!fkForm.column || !fkForm.refTable || !fkForm.refColumn" @click="submitFk">
            创建外键
          </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, h, onMounted, ref, watch } from 'vue'
import {
  NButton, NIcon, NModal, NForm, NFormItem, NInput, NSelect,
  NCheckbox, useMessage, useDialog
} from 'naive-ui'
import {
  Add16Regular, ArrowClockwise16Regular, Edit16Regular, Delete16Regular,
  TextGrammarWand16Regular, Key16Regular, Link16Regular
} from '@vicons/fluent'
import { store } from '../store'

const message = useMessage()
const dialog = useDialog()

const tab = ref('cols')
const loading = ref(false)
const saving = ref(false)
const structure = ref({ columns: [], indexes: [], ddl: '' })
const foreignKeys = ref([])

const typeOptions = [
  'INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
  'VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR', 'BLOB', 'JSON', 'ENUM', 'SET'
].map((t) => ({ label: t, value: t }))

const fkColumns = computed(() => new Set(foreignKeys.value.map((f) => f.columnName)))

onMounted(load)
watch(() => `${store.currentDb}.${store.currentTable}`, load)

async function load() {
  if (!store.currentTable) return
  loading.value = true
  try {
    const [st, fks] = await Promise.all([
      window.api.tableStructure(store.connId, store.currentDb, store.currentTable),
      window.api.foreignKeys(store.connId, store.currentDb, store.currentTable)
    ])
    structure.value = st
    foreignKeys.value = fks
  } catch (e) {
    message.error('加载结构失败：' + e.message)
  } finally {
    loading.value = false
  }
}

// ---------- 列编辑 ----------
const colModalShow = ref(false)
const colForm = ref({})
const colModalTitle = computed(() => (colForm.value.mode === 'add' ? '添加列' : '编辑列'))
const afterOptions = computed(() => structure.value.columns.map((c) => ({ label: c.field, value: c.field })))

function parseType(typeStr) {
  const m = String(typeStr).match(/^([a-z]+)(?:\(([^)]+)\))?/i)
  return m ? { type: m[1].toUpperCase(), length: m[2] || '' } : { type: typeStr, length: '' }
}

function openAddCol() {
  colForm.value = { mode: 'add', name: '', type: 'VARCHAR', length: '255', nullable: true, autoIncrement: false, defaultValue: '', comment: '', after: '' }
  colModalShow.value = true
}

function openEditCol(c) {
  const { type, length } = parseType(c.type)
  colForm.value = {
    mode: 'edit', oldName: c.field, name: c.field, type, length,
    nullable: c.nullable,
    autoIncrement: String(c.extra).includes('auto_increment'),
    defaultValue: c.default ?? '',
    comment: c.comment || ''
  }
  colModalShow.value = true
}

async function submitCol() {
  saving.value = true
  try {
    if (colForm.value.mode === 'add') {
      await window.api.addColumn(store.connId, store.currentDb, store.currentTable, { ...colForm.value })
      message.success('已添加列')
    } else {
      await window.api.modifyColumn(store.connId, store.currentDb, store.currentTable, colForm.value.oldName, { ...colForm.value })
      message.success('已保存')
    }
    colModalShow.value = false
    await load()
    await refreshSidebarTree()
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}

async function refreshSidebarTree() {
  if (store.expandedTables.includes(store.currentTable)) {
    store.tableColumns[store.currentTable] = await window.api.columns(store.connId, store.currentDb, store.currentTable)
  }
}

async function renameCol(c) {
  const newName = await askText('重命名列', '新列名', c.field)
  if (!newName || newName === c.field) return
  try {
    await window.api.renameColumn(store.connId, store.currentDb, store.currentTable, c.field, newName)
    message.success('已重命名')
    await load()
    await refreshSidebarTree()
  } catch (e) {
    message.error(e.message)
  }
}

function dropCol(c) {
  dialog.error({
    title: '删除列',
    content: `确定删除列 ${c.field}？该列数据将永久丢失。`,
    positiveText: '删除', negativeText: '取消',
    async onPositiveClick() {
      try {
        await window.api.dropColumn(store.connId, store.currentDb, store.currentTable, c.field)
        message.success('已删除列')
        await load()
        await refreshSidebarTree()
      } catch (e) { message.error(e.message) }
    }
  })
}

// ---------- 外键 ----------
const fkModalShow = ref(false)
const fkForm = ref({})
const fkEditing = ref(null)  // null=新增, string=原外键名=编辑
const fkModalTitle = computed(() => fkEditing.value ? `编辑外键 (${fkEditing.value})` : '添加外键')
const refTableOptions = ref([])
const refColumnOptions = ref([])

const ownColumnOptions = computed(() => structure.value.columns.map((c) => ({ label: c.field, value: c.field })))
const ruleOptions = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'].map((r) => ({ label: r, value: r }))

async function openAddFk() {
  fkEditing.value = null
  fkForm.value = { column: '', refTable: '', refColumn: '', onDelete: 'RESTRICT', onUpdate: 'RESTRICT', name: '' }
  refColumnOptions.value = []
  fkModalShow.value = true
  const tables = await window.api.tables(store.connId, store.currentDb)
  refTableOptions.value = tables.map((t) => ({ label: t, value: t }))
}

async function openEditFk(fk) {
  fkEditing.value = fk.name
  fkForm.value = { column: fk.columnName, refTable: fk.refTable, refColumn: fk.refColumn, onDelete: fk.onDelete, onUpdate: fk.onUpdate, name: fk.name }
  refTableOptions.value = [fk.refTable, ...(await window.api.tables(store.connId, store.currentDb))].map((t) => ({ label: t, value: t }))
  await onRefTableChange(fk.refTable)
  if (!refColumnOptions.value.find((o) => o.value === fk.refColumn)) {
    const cols = await window.api.columns(store.connId, store.currentDb, fk.refTable)
    refColumnOptions.value = cols.map((c) => ({ label: `${c.name} (${c.type})`, value: c.name }))
  }
  fkModalShow.value = true
}

async function onRefTableChange(t) {
  fkForm.value.refColumn = ''
  if (!t) { refColumnOptions.value = []; return }
  const cols = await window.api.columns(store.connId, store.currentDb, t)
  const preferred = cols.filter((c) => c.isPrimary || c.key === 'UNI')
  refColumnOptions.value = (preferred.length ? preferred : cols).map((c) => ({
    label: `${c.name} (${c.type})`,
    value: c.name
  }))
}

async function submitFk() {
  saving.value = true
  try {
    if (fkEditing.value) {
      const res = await window.api.modifyForeignKey(store.connId, store.currentDb, store.currentTable, fkEditing.value, { ...fkForm.value })
      message.success('外键已更新：' + (fkForm.value.name || fkForm.value.column) + '_fk')
    } else {
      const res = await window.api.addForeignKey(store.connId, store.currentDb, store.currentTable, { ...fkForm.value })
      message.success('外键已创建：' + res.name)
    }
    fkModalShow.value = false
    await load()
  } catch (e) {
    message.error('保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}

function dropFk(fk) {
  dialog.error({
    title: '删除外键',
    content: `确定删除外键约束 ${fk.name}？`,
    positiveText: '删除', negativeText: '取消',
    async onPositiveClick() {
      try {
        await window.api.dropForeignKey(store.connId, store.currentDb, store.currentTable, fk.name)
        message.success('已删除外键')
        await load()
      } catch (e) { message.error(e.message) }
    }
  })
}

async function copyDdl() {
  await navigator.clipboard.writeText(structure.value.ddl)
  message.success('DDL 已复制')
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
</script>

<style scoped>
.struct-root { height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.struct-toolbar { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.seg {
  display: inline-flex;
  background: var(--bg-hover);
  border-radius: var(--radius-m);
  padding: 3px;
  gap: 2px;
}
.seg button {
  border: none; background: transparent;
  color: var(--text-secondary);
  font-size: 12.5px; font-family: var(--font-ui);
  padding: 4px 14px; border-radius: 6px;
  cursor: pointer; transition: all .15s;
}
.seg button:hover { color: var(--text-primary); }
.seg button.active {
  background: var(--bg-surface);
  color: var(--accent-text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.struct-body {
  flex: 1; min-height: 0; overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  background: var(--bg-surface);
}
.ddl-body { position: relative; padding: 16px; }

.tbl { border-collapse: collapse; font-size: 12.5px; width: 100%; }
.tbl th {
  position: sticky; top: 0; z-index: 2;
  background: var(--bg-surface-raised);
  font-weight: 650; text-align: left;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-strong);
  border-right: 1px solid var(--border-subtle);
  white-space: nowrap;
}
.tbl td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  white-space: nowrap;
}
.tbl tr:hover td { background: var(--bg-hover); }
.mono { font-family: var(--font-mono); }
.strong { font-weight: 600; }
.accent { color: var(--accent-text); }
.muted { color: var(--text-tertiary); }
.ellipsis { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.null-cell { color: var(--text-tertiary); font-style: italic; }
.op-col { width: 110px; text-align: right; }
.empty-row { text-align: center; color: var(--text-tertiary); padding: 24px 0; }

.field-cell { display: inline-flex; align-items: center; gap: 6px; }
.field-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--text-tertiary); opacity: 0.45;
  margin: 0 4px; display: inline-block;
}
.ico-pk { color: #f5b942; }
.ico-fk { color: #4ea8ff; }
.ico-uni { color: #3dd68c; }
.ddl-code {
  font-family: var(--font-mono);
  font-size: 12.5px; line-height: 1.65;
  color: var(--text-primary);
  white-space: pre-wrap; word-break: break-all;
  margin: 0;
}
</style>
