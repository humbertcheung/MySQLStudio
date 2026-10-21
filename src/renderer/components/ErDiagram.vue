<template>
  <div class="er-root">
    <div v-if="!dict.length" class="er-empty">无表可展示</div>
    <template v-else>
      <div class="er-toolbar">
        <span class="er-hint">{{ dict.length }} 张表 · {{ edges.length }} 条外键关系</span>
        <n-checkbox v-model:checked="showFields" size="small" style="margin-left: 12px">显示字段</n-checkbox>
        <div style="flex: 1" />
        <n-button v-if="hasMoved" size="tiny" quaternary type="warning" @click="resetPositions" title="恢复自动布局">
          重置位置
        </n-button>
        <n-button size="tiny" quaternary @click="fitWidth" title="适应宽度">适应</n-button>
        <n-button size="tiny" quaternary @click="zoomOut" title="缩小">−</n-button>
        <span class="er-zoom">{{ Math.round(zoom * 100) }}%</span>
        <n-button size="tiny" quaternary @click="zoomIn" title="放大">+</n-button>
        <n-button size="tiny" quaternary @click="zoom = 1" title="重置缩放">重置</n-button>
      </div>

      <div class="er-canvas" ref="canvasEl">
        <svg :width="svgW * zoom" :height="svgH * zoom" :viewBox="`0 0 ${svgW} ${svgH}`">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-solid)" />
            </marker>
          </defs>

          <!-- 连线 -->
          <g class="edges">
            <path
              v-for="(e, i) in edgePaths"
              :key="'e' + i"
              :d="e.d"
              class="edge"
              :class="{ hot: hovered && (hovered === e.from || hovered === e.to) }"
              marker-end="url(#arrow)"
            />
            <text
              v-for="(e, i) in edgePaths"
              :key="'t' + i"
              :x="e.labelX"
              :y="e.labelY"
              class="edge-label"
              :class="{ hot: hovered && (hovered === e.from || hovered === e.to) }"
            >{{ e.label }}</text>
          </g>

          <!-- 表节点 -->
          <g
            v-for="n in nodes"
            :key="n.name"
            class="node"
            :class="{ hot: hovered === n.name, dim: hovered && hovered !== n.name && !relatedTo(hovered).has(n.name), dragging: dragState && dragState.name === n.name }"
            @mouseenter="hovered = n.name"
            @mouseleave="hovered = null"
            @mousedown.stop="onNodeMouseDown($event, n)"
          >
            <rect :x="n.x" :y="n.y" :width="NODE_W" :height="nodeHeight(n)" rx="10" class="node-bg" />
            <rect :x="n.x" :y="n.y" :width="NODE_W" :height="HEAD_H" rx="10" class="node-head" />
            <rect :x="n.x" :y="n.y + HEAD_H - 10" :width="NODE_W" :height="10" class="node-head-fill" />

            <text :x="n.x + 12" :y="n.y + 19" class="node-name">{{ n.name }}</text>
            <text v-if="n.comment" :x="n.x + 12" :y="n.y + 44" class="node-comment">{{ truncate(n.comment, 24) }}</text>
            <text :x="n.x + 12" :y="metaY(n)" class="node-meta">
              {{ n.columns.length }} 字段{{ n.foreignKeys.length ? ' · ' + n.foreignKeys.length + ' 外键' : '' }}
            </text>

            <!-- 字段列表（可开关）-->
            <g v-if="showFields">
              <g v-for="(c, ci) in n.columns" :key="c.name">
                <text :x="n.x + 12" :y="fieldY(n, ci)" class="node-field">
                  <tspan :class="{ 'f-pk': c.key === 'PRI', 'f-fk': isFk(n, c.name) }">{{ c.key === 'PRI' ? '🔑' : isFk(n, c.name) ? '🔗' : ' ' }}</tspan>
                  {{ truncate(c.name, 18) }}
                </text>
                <text :x="n.x + NODE_W - 10" :y="fieldY(n, ci)" class="node-field-type" text-anchor="end">
                  {{ shortType(c.type) }}
                </text>
              </g>
            </g>
            <!-- 紧凑模式：仅主键/外键列 -->
            <g v-else>
              <text
                v-for="(c, ci) in keyColumns(n)"
                :key="'k' + c.name"
                :x="n.x + 12" :y="fieldY(n, ci)"
                class="node-field"
              >
                <tspan :class="c.key === 'PRI' ? 'f-pk' : 'f-fk'">{{ c.key === 'PRI' ? '🔑' : '🔗' }}</tspan>
                {{ truncate(c.name, 20) }}
              </text>
            </g>
          </g>
        </svg>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { NButton, NCheckbox } from 'naive-ui'

const props = defineProps({ dict: { type: Array, required: true } })
const emit = defineEmits(['pick'])

// ---------- 尺寸常量（高度与坐标统一用这组值，保证内容不溢出）----------
const NODE_W = 280
const HEAD_H = 28
const META_Y_PLAIN = 48   // 无注释时 meta 行基线偏移
const META_Y_CMT = 62     // 有注释时
const FIELD_Y_PLAIN = 62  // 无注释时首个字段基线偏移
const FIELD_Y_CMT = 78    // 有注释时
const ROW_H = 15
const BOTTOM_PAD = 12
const GAP_X = 70
const GAP_Y = 100
const PAD = 40
const PER_ROW = 5

const zoom = ref(1)
const showFields = ref(true)
const hovered = ref(null)
const canvasEl = ref(null)

// ---------- 拖动位置（组件内状态，重启即重置）----------
const positions = ref({})
const dragState = ref(null)
const hasMoved = computed(() => Object.keys(positions.value).length > 0)

function metaY(n) {
  return n.y + (n.comment ? META_Y_CMT : META_Y_PLAIN)
}
function fieldY(n, ci) {
  const start = n.comment ? FIELD_Y_CMT : FIELD_Y_PLAIN
  return n.y + start + ci * ROW_H
}
function nodeHeight(n) {
  const shown = showFields.value ? n.columns.length : keyColumns(n).length
  const start = n.comment ? FIELD_Y_CMT : FIELD_Y_PLAIN
  // 高度 = 字段起始偏移 + 字段行数 + 底部留白（保证内容完全在卡片内）
  return start + shown * ROW_H + BOTTOM_PAD
}

function keyColumns(n) {
  return n.columns.filter((c) => c.key === 'PRI' || isFk(n, c.name))
}
function shortType(t) {
  return String(t).replace(/\(.*?\)/g, '').slice(0, 10)
}
function truncate(s, n) {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}
function isFk(table, colName) {
  return table.foreignKeys.some((f) => f.colName === colName)
}

// ---------- 自动布局（分层 + 层内多行，行高按该行最高卡片）----------
const autoLayout = computed(() => {
  const dict = props.dict
  const level = {}
  const calc = (name, seen) => {
    if (level[name] !== undefined) return level[name]
    if (seen.has(name)) return 0
    seen.add(name)
    const t = dict.find((x) => x.name === name)
    if (!t || !t.foreignKeys.length) { level[name] = 0; return 0 }
    let maxL = 0
    for (const f of t.foreignKeys) {
      if (f.refTable === name) continue
      maxL = Math.max(maxL, calc(f.refTable, new Set(seen)))
    }
    level[name] = maxL + 1
    return level[name]
  }
  dict.forEach((t) => calc(t.name, new Set()))

  const byLevel = {}
  dict.forEach((t) => {
    const l = level[t.name] || 0
    ;(byLevel[l] = byLevel[l] || []).push(t)
  })

  const out = []
  let yCursor = PAD
  Object.keys(byLevel).map(Number).sort((a, b) => b - a).forEach((l) => {
    const tables = byLevel[l]
    for (let r = 0; r < Math.ceil(tables.length / PER_ROW); r++) {
      const rowTables = tables.slice(r * PER_ROW, (r + 1) * PER_ROW)
      // 行高 = 该行最高卡片（避免下一行卡片重叠）
      const rowH = Math.max(...rowTables.map((t) => nodeHeight(t)))
      let x = PAD
      rowTables.forEach((t) => {
        out.push({ ...t, x, y: yCursor, _rowH: rowH })
        x += NODE_W + GAP_X
      })
      yCursor += rowH + GAP_Y
    }
  })
  return out
})

// 合并拖动后的位置
const nodes = computed(() =>
  autoLayout.value.map((n) => {
    const p = positions.value[n.name]
    return p ? { ...n, x: p.x, y: p.y } : n
  })
)

const svgW = computed(() => {
  if (!nodes.value.length) return 400
  return Math.max(...nodes.value.map((n) => n.x + NODE_W)) + PAD
})
const svgH = computed(() => {
  if (!nodes.value.length) return 300
  return Math.max(...nodes.value.map((n) => n.y + nodeHeight(n))) + PAD
})

// ---------- 边 ----------
const edges = computed(() => {
  const out = []
  for (const t of props.dict) {
    for (const f of t.foreignKeys) {
      if (f.refTable === t.name) continue
      if (!props.dict.find((x) => x.name === f.refTable)) continue
      out.push({ from: t.name, to: f.refTable, col: f.colName })
    }
  }
  return out
})

const edgePaths = computed(() => {
  const map = Object.fromEntries(nodes.value.map((n) => [n.name, n]))
  return edges.value.map((e) => {
    const a = map[e.from]
    const b = map[e.to]
    if (!a || !b) return null
    const x1 = a.x + NODE_W / 2
    const y1 = a.y
    const x2 = b.x + NODE_W / 2
    const y2 = b.y + nodeHeight(b)
    const my = (y1 + y2) / 2
    const d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
    const lx = x1 * 0.85 + x2 * 0.15
    const ly = y1 + (y2 - y1) * 0.22
    return { ...e, d, labelX: lx, labelY: ly, label: e.col }
  }).filter(Boolean)
})

function relatedTo(name) {
  const set = new Set([name])
  for (const e of edges.value) {
    if (e.from === name) set.add(e.to)
    if (e.to === name) set.add(e.from)
  }
  return set
}

// ---------- 拖动 ----------
function onNodeMouseDown(e, n) {
  if (e.button !== 0) return
  const startX = e.clientX
  const startY = e.clientY
  const origX = n.x
  const origY = n.y
  let moved = false
  dragState.value = { name: n.name }

  const onMove = (ev) => {
    const dx = (ev.clientX - startX) / zoom.value
    const dy = (ev.clientY - startY) / zoom.value
    if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 3) return
    moved = true
    positions.value = { ...positions.value, [n.name]: { x: Math.max(0, origX + dx), y: Math.max(0, origY + dy) } }
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    dragState.value = null
    // 未移动视为点击（跳转到结构视图）
    if (!moved) emit('pick', n.name)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function resetPositions() {
  positions.value = {}
}

// ---------- 缩放 ----------
function zoomIn() { zoom.value = Math.min(2, +(zoom.value + 0.15).toFixed(2)) }
function zoomOut() { zoom.value = Math.max(0.3, +(zoom.value - 0.15).toFixed(2)) }
function fitWidth() {
  const cw = canvasEl.value?.getBoundingClientRect().width || 1200
  zoom.value = Math.max(0.3, Math.min(1, +((cw - 24) / svgW.value).toFixed(2)))
}

onUnmounted(() => {
  dragState.value = null
})
</script>

<style scoped>
.er-root { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.er-toolbar { display: flex; align-items: center; gap: 6px; padding: 4px 2px 10px; flex-shrink: 0; }
.er-hint { font-size: 12px; color: var(--text-tertiary); }
.er-zoom { font-size: 11.5px; color: var(--text-secondary); font-family: var(--font-mono); min-width: 42px; text-align: center; }
.er-canvas {
  flex: 1; min-height: 0; overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-m);
  background:
    radial-gradient(circle at 1px 1px, var(--border-subtle) 1px, transparent 0) 0 0 / 22px 22px,
    var(--bg-surface);
}
.er-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); }
svg { display: block; }

.node { cursor: grab; }
.node.dragging { cursor: grabbing; }
.node-bg { fill: var(--bg-surface-raised); stroke: var(--border-strong); stroke-width: 1.5; transition: stroke .15s; }
.node-head { fill: var(--accent-solid); opacity: .16; pointer-events: none; }
.node-head-fill { fill: transparent; pointer-events: none; }
.node:hover .node-bg, .node.hot .node-bg { stroke: var(--accent-solid); stroke-width: 2; }
.node.dim { opacity: .35; }
.node text { pointer-events: none; }
.node-name { font-size: 13px; font-weight: 650; font-family: var(--font-mono); fill: var(--text-primary); }
.node-comment { font-size: 11px; fill: var(--text-secondary); }
.node-meta { font-size: 10.5px; fill: var(--text-tertiary); }
.node-field { font-size: 11px; font-family: var(--font-mono); fill: var(--text-secondary); }
.node-field .f-pk { fill: #f5b942; }
.node-field .f-fk { fill: #4ea8ff; }
.node-field-type { font-size: 9.5px; font-family: var(--font-mono); fill: var(--text-tertiary); }

.edge { fill: none; stroke: var(--border-strong); stroke-width: 1.5; transition: stroke .15s, stroke-width .15s; }
.edge.hot { stroke: var(--accent-solid); stroke-width: 2.5; }
.edge-label {
  font-size: 9.5px; font-family: var(--font-mono);
  fill: var(--text-tertiary); text-anchor: middle;
  paint-order: stroke; stroke: var(--bg-surface); stroke-width: 3.5px; stroke-linejoin: round;
}
.edge-label.hot { fill: var(--accent-text); font-weight: 600; }
</style>
