<template>
  <div class="rs-root">
    <div v-if="rs.columns.length" class="rs-grid">
      <table class="rs-tbl">
        <thead>
          <tr>
            <th
              v-for="(c, i) in rs.columns"
              :key="i"
              :data-col="c"
              :data-min-w="56"
              :style="colStyle(i)"
            >
              <span class="rs-col-name">{{ c }}</span>
              <span class="resize-handle" @click.stop></span>
            </th>
            <th class="filler-col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in rs.rows" :key="ri">
            <td v-for="(v, ci) in row" :key="ci">
              <span v-if="v === null" class="rs-null">NULL</span>
              <span v-else class="rs-text" :title="String(v)">{{ v }}</span>
            </td>
            <td class="filler-col"></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="rs-affected">
      <n-icon :component="CheckmarkCircle16Regular" size="18" />
      <span>执行成功 · 影响 {{ rs.affected }} 行</span>
      <span v-if="rs.info" class="rs-info">{{ rs.info }}</span>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { NIcon } from 'naive-ui'
import { CheckmarkCircle16Regular } from '@vicons/fluent'

const props = defineProps({ rs: { type: Object, required: true } })

// 列宽（按结果集隔离，不持久化）
const colWidths = ref({})

// 新结果集时重置列宽
watch(
  () => props.rs.columns?.join(','),
  () => {
    colWidths.value = {}
  }
)

function colStyle(i) {
  const w = colWidths.value[i]
  return w ? { width: w + 'px', minWidth: w + 'px' } : { width: 'auto' }
}

// 全局列宽拖动事件（由 main.js 的事件委托派发）
function applyColWidth(e) {
  const { th, width } = e.detail
  if (!th || !width) return
  if (!th.closest('.rs-tbl')) return
  const idx = [...th.parentElement.children].indexOf(th)
  if (idx < 0) return
  colWidths.value = { ...colWidths.value, [idx]: Math.round(width) }
}

onMounted(() => {
  window.addEventListener('col-resizing', applyColWidth)
  window.addEventListener('col-resized', applyColWidth)
})
onUnmounted(() => {
  window.removeEventListener('col-resizing', applyColWidth)
  window.removeEventListener('col-resized', applyColWidth)
})
</script>

<style scoped>
.rs-root { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.rs-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  background: var(--bg-surface);
}
.rs-tbl { border-collapse: collapse; font-size: 12.5px; table-layout: fixed; width: 100%; min-width: max-content; }
.rs-tbl th { position: relative; }
.rs-col-name { display: inline-block; padding: 0 4px; cursor: pointer; border-radius: 3px; }
.rs-col-name:hover { background: var(--bg-hover); color: var(--accent-text); }
.rs-tbl thead th {
  position: sticky; top: 0; z-index: 2;
  background: var(--bg-surface-raised);
  font-weight: 650; text-align: left;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-strong);
  border-right: 1px solid var(--border-subtle);
  white-space: nowrap;
}
.rs-tbl td {
  padding: 5px 12px;
  border-bottom: 1px solid var(--border-subtle);
  border-right: 1px solid var(--border-subtle);
  font-family: var(--font-mono);
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  vertical-align: middle;
}
.rs-tbl tr:hover td { background: var(--bg-hover); }
/* 填充列：完全透明，吸收剩余空间 */
.filler-col {
  width: auto !important;
  min-width: 0 !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  pointer-events: none;
}
.rs-tbl tr:hover .filler-col { background: transparent !important; }
.rs-tbl th.filler-col { background: transparent !important; border-bottom: none !important; }
.rs-null { color: var(--text-tertiary); font-style: italic; }
.rs-affected {
  padding: 24px;
  color: var(--success-text);
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
}
.rs-info { color: var(--text-tertiary); font-size: 12px; }
</style>
