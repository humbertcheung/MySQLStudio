<template>
  <div v-if="!store.currentDb" class="empty-state"><span>请先选择数据库</span></div>
  <div v-else class="dict-root">
    <!-- 工具条 -->
    <div class="dict-toolbar">
      <div class="seg">
        <button :class="{ active: view === 'struct' }" @click="view = 'struct'">结构</button>
        <button :class="{ active: view === 'er' }" @click="view = 'er'">关系图</button>
      </div>
      <n-input
        v-if="view === 'struct'"
        v-model:value="filter"
        size="small"
        placeholder="搜索表 / 字段…"
        clearable
        style="width: 220px"
      >
        <template #prefix><n-icon :component="Search16Regular" /></template>
      </n-input>
      <n-tag size="small" :bordered="false">{{ dict.length }} 张表</n-tag>
      <div style="flex: 1" />
      <n-button size="small" quaternary @click="load" :loading="loading" title="刷新">
        <template #icon><n-icon :component="ArrowClockwise16Regular" /></template>
      </n-button>
      <n-dropdown :options="exportOptions" @select="doExport">
        <n-button size="small" secondary type="primary">
          <template #icon><n-icon :component="ArrowExportLtr16Regular" /></template>
          导出数据字典
        </n-button>
      </n-dropdown>
    </div>

    <!-- 关系图视图 -->
    <ErDiagram v-if="view === 'er'" :dict="dict" @pick="onPickTable" />

    <!-- 结构视图 -->
    <div v-else class="dict-body">
      <n-scrollbar>
        <section v-for="t in filtered" :key="t.name" :id="'dict-' + t.name" class="tbl-section">
          <div class="tbl-head">
            <n-icon :component="Table16Regular" size="15" class="tbl-icon" />
            <span class="tbl-name">{{ t.name }}</span>
            <span v-if="t.comment" class="tbl-comment">{{ t.comment }}</span>
            <div style="flex: 1" />
            <span class="tbl-meta">{{ t.engine }}</span>
            <span class="tbl-meta">{{ t.rowsEst ?? '-' }} 行</span>
          </div>

          <table class="dict-tbl">
            <thead>
              <tr>
                <th class="w-name">字段</th>
                <th class="w-type">类型</th>
                <th class="w-null">可空</th>
                <th class="w-key">键</th>
                <th class="w-def">默认值</th>
                <th class="w-extra">Extra</th>
                <th>注释</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in filterColumns(t)" :key="c.name">
                <td class="mono strong">
                  <n-icon v-if="c.key === 'PRI'" :component="Key16Regular" size="12" class="ico-pk" title="主键" />
                  <n-icon v-else-if="fkColumns(t).has(c.name)" :component="Link16Regular" size="12" class="ico-fk" title="外键" />
                  {{ c.name }}
                </td>
                <td class="mono accent">{{ c.type }}</td>
                <td>{{ c.nullable ? 'YES' : 'NO' }}</td>
                <td>
                  <span v-if="c.key === 'PRI'" class="tag-pk">PK</span>
                  <span v-else-if="c.key === 'UNI'" class="tag-uni">UNI</span>
                  <span v-else-if="c.key === 'MUL'" class="tag-mul">IDX</span>
                </td>
                <td class="mono">
                  <span v-if="c.defaultValue === null" class="null-cell">NULL</span>
                  <span v-else>{{ c.defaultValue }}</span>
                </td>
                <td class="mono muted">{{ c.extra }}</td>
                <td class="comment-cell">{{ c.comment }}</td>
              </tr>
            </tbody>
          </table>

          <div v-if="t.foreignKeys.length" class="sub-block">
            <div class="sub-title">外键</div>
            <table class="dict-tbl small">
              <thead><tr><th>约束名</th><th>列</th><th>引用</th><th>ON DELETE</th><th>ON UPDATE</th></tr></thead>
              <tbody>
                <tr v-for="f in t.foreignKeys" :key="f.name">
                  <td class="mono">{{ f.name }}</td>
                  <td class="mono">{{ f.colName }}</td>
                  <td class="mono ref">{{ f.refTable }}.{{ f.refColumn }}</td>
                  <td class="muted">{{ f.onDelete }}</td>
                  <td class="muted">{{ f.onUpdate }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="t.indexes.length" class="sub-block">
            <div class="sub-title">索引</div>
            <table class="dict-tbl small">
              <thead><tr><th>索引名</th><th>列</th><th>唯一</th><th>类型</th></tr></thead>
              <tbody>
                <tr v-for="(x, k) in t.indexes" :key="k">
                  <td class="mono">{{ x.name }}</td>
                  <td class="mono">{{ x.colName }}</td>
                  <td>{{ x.nonUnique ? 'NO' : 'YES' }}</td>
                  <td class="muted">{{ x.type }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <div v-if="!filtered.length" class="dict-empty">
          {{ loading ? '加载中…' : '无匹配的表' }}
        </div>
      </n-scrollbar>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { NInput, NButton, NIcon, NTag, NDropdown, NScrollbar, useMessage } from 'naive-ui'
import {
  Search16Regular, ArrowClockwise16Regular, ArrowExportLtr16Regular,
  Table16Regular, Key16Regular, Link16Regular
} from '@vicons/fluent'
import { store } from '../store'
import ErDiagram from './ErDiagram.vue'

const message = useMessage()
const dict = ref([])
const loading = ref(false)
const filter = ref('')
const view = ref('struct')

// 从关系图点击表 → 切回结构视图并滚动到该表
async function onPickTable(name) {
  view.value = 'struct'
  await new Promise((r) => setTimeout(r, 150))
  const el = document.getElementById('dict-' + name)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const exportOptions = [
  { label: '导出为 HTML（推荐）', key: 'html' },
  { label: '导出为 Markdown', key: 'md' },
  { label: '导出为 CSV', key: 'csv' }
]

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return dict.value
  return dict.value
    .map((t) => ({
      ...t,
      columns: t.columns.filter(
        (c) => c.name.toLowerCase().includes(q) || c.comment.toLowerCase().includes(q)
      ),
      _tableMatch: t.name.toLowerCase().includes(q) || t.comment.toLowerCase().includes(q)
    }))
    .filter((t) => t._tableMatch || t.columns.length)
})

function filterColumns(t) {
  return t.columns
}

function fkColumns(t) {
  return new Set(t.foreignKeys.map((f) => f.colName))
}

async function load() {
  if (!store.currentDb) return
  loading.value = true
  try {
    dict.value = await window.api.dataDictionary(store.connId, store.currentDb)
  } catch (e) {
    message.error('加载数据字典失败：' + e.message)
  } finally {
    loading.value = false
  }
}

async function doExport(format) {
  const res = await window.api.exportDictionary(store.connId, store.currentDb, format)
  if (res.ok) message.success(`已导出 ${res.tables} 张表的字典：${res.path}`)
}

// 监听连接与库变化（immediate：挂载时若数据已就绪立即加载）
watch(
  () => [store.connId, store.currentDb],
  ([connId, db]) => {
    if (connId && db) load()
  },
  { immediate: true }
)
</script>

<style scoped>
.seg {
  display: inline-flex; background: var(--bg-hover);
  border-radius: var(--radius-m); padding: 3px; gap: 2px; flex-shrink: 0;
}
.seg button {
  border: none; background: transparent; color: var(--text-secondary);
  font-size: 12.5px; font-family: var(--font-ui); padding: 3px 14px;
  border-radius: 6px; cursor: pointer; transition: all .15s;
}
.seg button:hover { color: var(--text-primary); }
.seg button.active {
  background: var(--bg-surface); color: var(--accent-text);
  font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.25);
}
.dict-root { height: 100%; display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.dict-toolbar { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.dict-body {
  flex: 1; min-height: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  background: var(--bg-surface);
}
.tbl-section { padding: 14px 16px 18px; border-bottom: 1px solid var(--border-subtle); }
.tbl-section:last-child { border-bottom: none; }
.tbl-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tbl-icon { color: var(--accent-text); opacity: .8; }
.tbl-name { font-size: 14px; font-weight: 650; font-family: var(--font-mono); }
.tbl-comment { font-size: 12.5px; color: var(--text-secondary); }
.tbl-meta { font-size: 11.5px; color: var(--text-tertiary); font-family: var(--font-mono); }

.dict-tbl { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.dict-tbl th {
  background: var(--bg-surface-raised); font-weight: 650; text-align: left;
  padding: 6px 10px; border: 1px solid var(--border-subtle); white-space: nowrap;
  color: var(--text-secondary); font-size: 12px;
}
.dict-tbl td { padding: 5px 10px; border: 1px solid var(--border-subtle); }
.dict-tbl.small { margin-top: 6px; }
.w-name { width: 180px; } .w-type { width: 160px; } .w-null { width: 60px; }
.w-key { width: 60px; } .w-def { width: 130px; } .w-extra { width: 120px; }
.mono { font-family: var(--font-mono); }
.strong { font-weight: 600; }
.accent { color: var(--accent-text); }
.muted { color: var(--text-tertiary); }
.ref { color: #4ea8ff; }
.null-cell { color: var(--text-tertiary); font-style: italic; }
.comment-cell { color: var(--text-secondary); }
.ico-pk { color: #f5b942; margin-right: 4px; vertical-align: -1px; }
.ico-fk { color: #4ea8ff; margin-right: 4px; vertical-align: -1px; }
.tag-pk { color: #f5b942; font-weight: 700; font-size: 11px; }
.tag-uni { color: #3dd68c; font-weight: 700; font-size: 11px; }
.tag-mul { color: #4ea8ff; font-weight: 700; font-size: 11px; }
.sub-block { margin-top: 12px; }
.sub-title {
  font-size: 11.5px; font-weight: 600; color: var(--text-tertiary);
  text-transform: uppercase; letter-spacing: .4px; margin-bottom: 2px;
}
.dict-empty { text-align: center; color: var(--text-tertiary); padding: 40px 0; }
</style>
