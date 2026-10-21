<template>
  <div v-if="!store.currentTable" class="empty-state"><span>从左侧选择一个表</span></div>
  <div v-else class="data-root">
    <!-- 工具条 -->
    <div class="toolbar">
      <n-input
        v-model:value="where"
        size="small"
        placeholder="WHERE 条件（如 id > 10），回车应用"
        style="width: 300px"
        @keyup.enter="load(0)"
        clearable
      >
        <template #prefix><n-icon :component="Filter16Regular" /></template>
      </n-input>
      <n-button size="small" quaternary @click="load(page)" :loading="loading" title="刷新">
        <template #icon><n-icon :component="ArrowClockwise16Regular" /></template>
      </n-button>
      <n-tag v-if="loading" size="small" :bordered="false">加载中…</n-tag>
      <n-tag v-else size="small" :bordered="false">{{ total }} 行</n-tag>

      <div style="flex: 1" />

      <n-button size="small" secondary type="primary" :disabled="!hasPk" @click="openInsert">
        <template #icon><n-icon :component="Add16Regular" /></template>
        新增行
      </n-button>
      <n-button size="small" secondary type="error" :disabled="!checked.size || !hasPk" @click="deleteChecked">
        <template #icon><n-icon :component="Delete16Regular" /></template>
        删除选中<span v-if="checked.size">（{{ checked.size }}）</span>
      </n-button>
      <n-dropdown :options="exportOptions" @select="doExport">
        <n-button size="small" secondary>
          <template #icon><n-icon :component="ArrowExportLtr16Regular" /></template>
          导出
        </n-button>
      </n-dropdown>
      <n-tag v-if="!hasPk && columns.length" size="small" type="warning" :bordered="false">无主键（视图）· 只读</n-tag>
    </div>

    <!-- 网格 -->
    <div class="grid-wrap" :class="{ dim: loading }">
      <table class="tbl">
        <thead>
          <tr>
            <th class="chk-col">
              <div><input type="checkbox" :checked="allChecked" :disabled="!hasPk" @change="toggleAll" /></div>
            </th>
            <th
              v-for="(c, ci) in columns"
              :key="ci"
              class="col-head"
              :data-col="c"
              :data-min-w="colMinWidth(c)"
              :style="thStyle(c)"
            >
              <span class="col-name" @click="toggleSort(c)">
                <n-icon v-if="colIcon(c, ci)" :component="colIcon(c, ci).comp" size="13" :class="colIcon(c, ci).cls" />
                {{ c }}
                <span v-if="sortCol === c" class="sort-arrow">{{ sortDir === 'desc' ? '▼' : '▲' }}</span>
              </span>
              <span class="resize-handle" @click.stop></span>
            </th>
            <th class="filler-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in rows" :key="ri" :class="{ selected: checked.has(ri) }">
            <td class="chk-col">
              <div><input type="checkbox" :checked="checked.has(ri)" :disabled="!hasPk" @change="toggleRow(ri)" /></div>
            </td>
            <td
              v-for="(v, ci) in row"
              :key="ci"
              class="cell"
              :class="{ editable: hasPk, editing: isEditing(ri, ci) }"
              @dblclick="startEdit(ri, ci)"
            >
              <div v-if="isEditing(ri, ci)" class="edit-box">
                <input
                  ref="editInput"
                  class="cell-input"
                  :value="editing.value"
                  @input="editing.value = $event.target.value"
                  @keydown.enter="commitEdit"
                  @keydown.esc="cancelEdit"
                  @blur="onEditBlur"
                  autofocus
                />
                <!-- 失焦且有变化 → 显示保存/取消 -->
                <div v-if="editing.pending" class="edit-actions">
                  <button class="save" title="保存到数据库（Enter）" @mousedown.prevent @click.stop="commitEdit">保存</button>
                  <button class="cancel" title="放弃修改（Esc）" @mousedown.prevent @click.stop="cancelEdit">取消</button>
                </div>
              </div>
              <span v-else-if="v === null" class="null-cell">NULL</span>
              <span v-else class="cell-text" :title="String(v)">{{ v }}</span>
            </td>
            <td class="filler-col"></td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td :colspan="columns.length + 2" class="empty-row">无数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="pager">
      <span class="pager-info">
        第 {{ page * pageSize + 1 }}–{{ Math.min((page + 1) * pageSize, total) }} 条 / 共 {{ total }} 条
        <span v-if="elapsed" class="elapsed">· {{ elapsed.toFixed(3) }}s</span>
      </span>
      <div style="flex: 1" />
      <n-select v-model:value="pageSize" size="tiny" :options="pageSizeOptions" style="width: 100px" @update:value="load(0)" />
      <n-button size="tiny" quaternary :disabled="page === 0 || loading" @click="load(page - 1)">上一页</n-button>
      <span class="pager-page">{{ page + 1 }} / {{ totalPages }}</span>
      <n-button size="tiny" quaternary :disabled="page + 1 >= totalPages || loading" @click="load(page + 1)">下一页</n-button>
    </div>

    <!-- 新增行 -->
    <n-modal v-model:show="insertShow" preset="card" title="新增行" style="width: 560px">
      <div class="insert-form">
        <div v-for="c in columns" :key="c" class="insert-row">
          <label>{{ c }}</label>
          <n-input v-model:value="insertForm[c]" size="small" :placeholder="`留空则用默认值`" />
        </div>
      </div>
      <template #footer>
        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <n-button @click="insertShow = false">取消</n-button>
          <n-button type="primary" @click="doInsert">插入</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NInput, NButton, NIcon, NDropdown, NTag, NModal, NSelect, useMessage, useDialog
} from 'naive-ui'
import {
  Filter16Regular, ArrowClockwise16Regular, Add16Regular, Delete16Regular, ArrowExportLtr16Regular,
  Key16Regular, Link16Regular
} from '@vicons/fluent'
import { store } from '../store'

const message = useMessage()
const dialog = useDialog()

// 监听全局列宽调整事件，记忆
// 拖动中实时同步（防止 Vue 重渲染用旧值覆盖）
const onColResizing = (e) => {
  const { col, width } = e.detail
  if (!col || !width) return
  const key = `${store.currentDb}.${store.currentTable}`
  const all = { ...store.columnWidths }
  all[key] = { ...(all[key] || {}), [col]: Math.round(width) }
  store.columnWidths = all
}
// 拖动结束：持久化
const onColResized = (e) => {
  const { col, width } = e.detail
  if (!col || !width) return
  const key = `${store.currentDb}.${store.currentTable}`
  const all = { ...store.columnWidths }
  all[key] = { ...(all[key] || {}), [col]: Math.round(width) }
  store.columnWidths = all
  localStorage.setItem('ms-cw', JSON.stringify(all))
}
onMounted(() => {
  window.addEventListener('col-resizing', onColResizing)
  window.addEventListener('col-resized', onColResized)
})
onUnmounted(() => {
  window.removeEventListener('col-resizing', onColResizing)
  window.removeEventListener('col-resized', onColResized)
})

const columns = ref([])
const rows = ref([])
const total = ref(0)
const pkColumns = ref([])
const loading = ref(false)
const elapsed = ref(0)
const page = ref(0)
const pageSize = ref(100)
const sortCol = ref(null)
const sortDir = ref('asc')
const where = ref('')
const checked = ref(new Set())
const editing = ref(null)
const editInput = ref(null)

const tableKey = computed(() => `${store.currentDb}.${store.currentTable}`)
const hasPk = computed(() => pkColumns.value.length > 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const pageSizeOptions = [50, 100, 200, 500].map((n) => ({ label: `${n}/页`, value: n }))
const allChecked = computed(() => rows.value.length > 0 && checked.value.size === rows.value.length)

function saveColWidth(name, width) {
  const key = `${store.currentDb}.${store.currentTable}`
  const all = { ...store.columnWidths }
  all[key] = { ...(all[key] || {}), [name]: width }
  store.columnWidths = all
  localStorage.setItem('ms-cw', JSON.stringify(all))
}

function colWidth(name) {
  const saved = store.columnWidths[`${store.currentDb}.${store.currentTable}`]
  if (saved && saved[name]) return saved[name]
  // 类型感知：日期时间类默认不小于 176（保证完整显示 "2026-09-16 10:00:28"）
  const cols = store.tableColumns[store.currentTable]
  const col = cols?.find((c) => c.name === name)
  const type = String(col?.type || '').toLowerCase()
  if (/^(datetime|timestamp|date|time)\b/.test(type)) return 176
  // 默认 = 字符宽度估算（中文 × 14px，英文 × 8px）+ padding
  let w = 0
  for (const ch of String(name)) {
    w += ch.charCodeAt(0) > 127 ? 14 : 8
  }
  return Math.min(420, Math.max(100, w + 48))
}

// 拖动时的最小宽度：日期时间类 176（保证完整显示），其他 56
function colMinWidth(name) {
  const cols = store.tableColumns[store.currentTable]
  const col = cols?.find((c) => c.name === name)
  const type = String(col?.type || '').toLowerCase()
  if (/^(datetime|timestamp|date|time)\b/.test(type)) return 176
  return 56
}

function thStyle(name) {
  const w = colWidth(name)
  return { minWidth: w + 'px', width: w + 'px' }
}

function colIcon(name, idx) {
  const cols = store.tableColumns[store.currentTable]
  if (!cols) return null
  const c = cols.find((x) => x.name === name)
  if (!c) return null
  if (c.isPrimary) return { comp: Key16Regular, cls: 'ico-pk' }
  if (c.isForeign) return { comp: Link16Regular, cls: 'ico-fk' }
  return null
}


function toggleAll(e) {
  checked.value = e.target.checked ? new Set(rows.value.map((_, i) => i)) : new Set()
}
function toggleRow(ri) {
  const s = new Set(checked.value)
  s.has(ri) ? s.delete(ri) : s.add(ri)
  checked.value = s
}

function toggleSort(c) {
  if (sortCol.value === c) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortCol.value = c
    sortDir.value = 'asc'
  }
  load(0)
}

function pkOf(row) {
  const idx = new Map(columns.value.map((c, i) => [c, i]))
  return Object.fromEntries(pkColumns.value.map((p) => [p, row[idx.get(p)]]))
}

async function load(newPage = 0) {
  if (!store.currentTable) return
  loading.value = true
  checked.value = new Set()
  editing.value = null
  const t0 = performance.now()
  try {
    const res = await window.api.selectPage(store.connId, store.currentDb, store.currentTable, {
      page: newPage,
      pageSize: pageSize.value,
      sortCol: sortCol.value,
      sortDir: sortDir.value,
      where: where.value
    })
    columns.value = res.columns
    rows.value = res.rows
    total.value = res.total
    pkColumns.value = res.pkColumns
    page.value = newPage
    elapsed.value = (performance.now() - t0) / 1000
  } catch (e) {
    message.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

// 内联编辑
function isEditing(ri, ci) {
  return editing.value && editing.value.ri === ri && editing.value.ci === ci
}

function startEdit(ri, ci) {
  if (!hasPk.value) return
  editing.value = { ri, ci, value: rows.value[ri][ci] ?? '', pending: false }
  nextTick(() => {
    const el = document.querySelector('.cell-input')
    el?.focus()
    el?.select()
  })
}

// 失焦：有变化 → 进入"待保存"状态，显示保存/取消按钮
function onEditBlur() {
  const ed = editing.value
  if (!ed) return
  const oldVal = rows.value[ed.ri][ed.ci] ?? ''
  if (ed.value === oldVal) {
    editing.value = null
  } else {
    ed.pending = true
  }
}

function cancelEdit() {
  editing.value = null
}

async function commitEdit() {
  const ed = editing.value
  if (!ed) return
  const oldVal = rows.value[ed.ri][ed.ci]
  if (ed.value === (oldVal ?? '')) {
    editing.value = null
    return
  }

  // 非空校验：NOT NULL 列不允许空值
  const colName = columns.value[ed.ci]
  const colMeta = store.tableColumns[store.currentTable]?.find((c) => c.name === colName)
  if (colMeta && !colMeta.nullable && String(ed.value).trim() === '') {
    message.error(`列「${colName}」为 NOT NULL，不能保存空值`)
    return // 保持编辑状态，让用户修改或取消
  }

  try {
    await window.api.updateCell(
      store.connId, store.currentDb, store.currentTable,
      pkOf(rows.value[ed.ri]), colName, ed.value
    )
    rows.value[ed.ri][ed.ci] = ed.value === '' ? null : ed.value
    editing.value = null
    message.success('已保存')
  } catch (e) {
    message.error('保存失败：' + e.message)
  }
}

// 新增
const insertShow = ref(false)
const insertForm = ref({})
function openInsert() {
  insertForm.value = Object.fromEntries(columns.value.map((c) => [c, '']))
  insertShow.value = true
}
async function doInsert() {
  try {
    const values = {}
    for (const [k, v] of Object.entries(insertForm.value)) {
      if (v !== '' && v !== null) values[k] = v
    }
    await window.api.insertRow(store.connId, store.currentDb, store.currentTable, values)
    message.success('已插入')
    insertShow.value = false
    load(page.value)
  } catch (e) {
    message.error('插入失败：' + e.message)
  }
}

// 删除
function deleteChecked() {
  const target = rows.value.filter((_, i) => checked.value.has(i))
  dialog.error({
    title: '删除行',
    content: `确定删除选中的 ${target.length} 行？`,
    positiveText: '删除', negativeText: '取消',
    async onPositiveClick() {
      try {
        for (const r of target) {
          await window.api.deleteRow(store.connId, store.currentDb, store.currentTable, pkOf(r))
        }
        message.success(`已删除 ${target.length} 行`)
        load(page.value)
      } catch (e) { message.error('删除失败：' + e.message) }
    }
  })
}

const exportOptions = [
  { label: '导出为 CSV', key: 'csv' },
  { label: '导出为 JSON', key: 'json' }
]
async function doExport(format) {
  const res = await window.api.exportTable(store.connId, store.currentDb, store.currentTable, format)
  if (!res.canceled) message.success(`已导出 ${res.rows} 行`)
}

watch(tableKey, () => {
  sortCol.value = null; where.value = ''; load(0)
  ensureColumns()
}, { immediate: true })

// 确保字段元信息已加载（让表头图标始终显示，不依赖侧栏字段树展开）
async function ensureColumns() {
  if (!store.currentTable) return
  if (store.tableColumns[store.currentTable]) return
  try {
    store.tableColumns[store.currentTable] = await window.api.columns(store.connId, store.currentDb, store.currentTable)
  } catch {}
}
</script>

<style scoped>
.data-root { display: flex; flex-direction: column; height: 100%; gap: 10px; min-height: 0; padding-bottom: 12px; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  background: var(--bg-surface);
  transition: opacity .15s;
}
.grid-wrap.dim { opacity: 0.6; }

.tbl { border-collapse: collapse; font-size: 12.5px; table-layout: fixed; width: 100%; min-width: max-content; }
.tbl th {
  position: sticky; top: 0; z-index: 2;
  background: var(--bg-surface-raised);
  font-weight: 650; text-align: left;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-strong);
  border-right: 1px solid var(--border-subtle);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.tbl th:hover { color: var(--accent-text); }
.col-name { margin-right: 4px; padding: 0 4px; border-radius: 3px; cursor: pointer; display: inline-block; }
.col-name:hover { background: var(--bg-hover); color: var(--accent-text); }
.sort-arrow { color: var(--accent-solid); font-size: 10px; }
.tbl td {
  padding: 5px 12px;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tbl tr:hover td { background: var(--bg-hover); }
.tbl tr.selected td { background: var(--accent-subtle); }
/* 填充列：完全透明，吸收剩余空间（视觉上是表格右侧空白，不是一列）*/
.filler-col {
  width: auto !important;
  min-width: 0 !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  pointer-events: none;
}
.tbl tr:hover .filler-col { background: transparent !important; }
.tbl th.filler-col { background: transparent !important; border-bottom: none !important; }
.chk-col { width: 36px; padding: 0; vertical-align: middle; position: sticky; left: 0; background: var(--bg-surface); z-index: 1; }
.chk-col > * { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.chk-col input[type='checkbox'] { margin: 0; vertical-align: middle; }
.tbl th.chk-col { z-index: 3; background: var(--bg-surface-raised); }
.cell.editable { cursor: cell; }
.cell.editing { overflow: visible; max-width: none; }
.null-cell { color: var(--text-tertiary); font-style: italic; opacity: 0.7; }
.edit-box { position: relative; display: flex; align-items: center; min-width: 0; }
.cell-input {
  width: 100%;
  background: var(--bg-page);
  border: 1px solid var(--accent-solid);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12.5px;
  padding: 2px 6px;
  outline: none;
}
/* 失焦后的保存/取消浮层 */
.edit-actions {
  position: absolute;
  top: -28px;
  right: 0;
  display: flex;
  gap: 4px;
  z-index: 20;
  background: var(--bg-surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 2px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
}
.edit-actions button {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-family: var(--font-ui);
  transition: opacity .12s;
}
.edit-actions button:hover { opacity: .85; }
.edit-actions .save { background: var(--accent-solid); color: #fff; font-weight: 600; }
.edit-actions .cancel { background: var(--bg-hover); color: var(--text-secondary); }
.empty-row { text-align: center; color: var(--text-tertiary); padding: 30px 0; }

.pager { display: flex; align-items: center; gap: 8px; flex-shrink: 0; font-size: 12.5px; padding-bottom: 4px; }
.pager-info { color: var(--text-secondary); }
.elapsed { color: var(--text-tertiary); }
.pager-page { color: var(--text-secondary); font-family: var(--font-mono); }

.insert-form { max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.insert-row { display: grid; grid-template-columns: 130px 1fr; gap: 10px; align-items: center; }
.insert-row label { font-size: 12.5px; color: var(--text-secondary); text-align: right; font-family: var(--font-mono); }
</style>
