import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'

// Monaco worker 配置（SQL 高亮内置，仅需通用 editor worker）
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
}

const app = createApp(App)

// 列宽拖动：window 级 + capture 阶段（最广最早），preventDefault 阻止任何浏览器默认行为（text selection、click 合成）
window.addEventListener(
  'mousedown',
  (e) => {
    const handle = e.target.closest?.('.resize-handle')
    if (!handle) return
    const th = handle.closest('th')
    if (!th) return
    e.preventDefault()
    e.stopPropagation()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    // 最小宽度：优先 data-min-w（日期列 176），否则表头文字宽度 + padding
    const nameEl = th.querySelector('.col-name, .rs-col-name')
    const minW = parseInt(th.dataset.minW) || (nameEl ? Math.max(56, nameEl.scrollWidth + 30) : 56)
    const table = th.closest('table')
    const lockTableWidth = () => {
      if (!table) return
      // 拖动时锁定表格宽度 = 各列宽之和，避免 table width:100% 拉伸列宽
      let total = 0
      for (const t of table.querySelectorAll('thead th')) {
        total += t.getBoundingClientRect().width
      }
      table.style.width = total + 'px'
      table.style.minWidth = total + 'px'
    }

    const onMove = (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      // 绝对坐标计算：列宽 = 鼠标 X - 列左边界（实时读取，兼容拖动中横向滚动）
      const w = Math.max(minW, Math.min(2400, ev.clientX - th.getBoundingClientRect().left))
      th.style.width = w + 'px'
      th.style.minWidth = w + 'px'
      // 实时同步给组件（防止 Vue 重渲染用旧值覆盖）
      window.dispatchEvent(new CustomEvent('col-resizing', { detail: { th, col: th.dataset.col, width: w } }))
      lockTableWidth()
      // Excel 行为：拖到 grid-wrap 边缘时自动滚动让 handle 跟随鼠标
      const wrap = th.closest('.grid-wrap') || th.closest('.rs-grid')
      if (wrap) {
        const wr = wrap.getBoundingClientRect()
        const hx = handle.getBoundingClientRect()
        const margin = 4
        if (hx.right > wr.right - margin) {
          wrap.scrollLeft += hx.right - (wr.right - margin)
        } else if (hx.left < wr.left + margin) {
          wrap.scrollLeft -= (wr.left + margin) - hx.left
        }
      }
    }
    const onUp = (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      const finalW = parseFloat(th.style.width) || minW
      window.dispatchEvent(new CustomEvent('col-resized', { detail: { th, col: th.dataset.col, width: finalW } }))
      // 保持表格锁定宽度（不回到 100%，避免拉伸）
    }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
  },
  true
)

app.mount('#app')

// dev 便利：暴露 store 供自动化测试直接操作状态
if (import.meta.env.DEV) {
  import('./store').then((m) => {
    window.__msStore = m.store
  })
}