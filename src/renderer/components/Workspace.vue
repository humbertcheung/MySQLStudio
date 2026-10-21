<template>
  <div class="ws-root">
    <Sidebar v-if="store.sidebarVisible" class="ws-sidebar" />

    <div class="ws-main">
      <!-- 顶部工具条 -->
      <div class="ws-toolbar">
        <n-button quaternary size="small" :title="store.sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'" @click="store.sidebarVisible = !store.sidebarVisible">
          <template #icon><n-icon :component="PanelLeftContract20Regular" /></template>
        </n-button>
        <n-button quaternary size="small" title="导入 .sql 文件到当前数据库" @click="importSql">
          <template #icon><n-icon :component="DocumentArrowDown16Regular" /></template>
        </n-button>
        <n-breadcrumb>
          <n-breadcrumb-item v-if="store.currentDb">
            <n-icon :component="Database20Regular" style="vertical-align: -2px" />
            {{ store.currentDb }}
          </n-breadcrumb-item>
          <n-breadcrumb-item v-if="store.currentTable">
            {{ store.currentTable }}
          </n-breadcrumb-item>
        </n-breadcrumb>
        <div style="flex: 1" />
        <n-tag size="small" :bordered="false" type="primary" round>MySQL {{ store.serverVersion }}</n-tag>
        <n-button quaternary size="small" @click="disconnect" type="error">
          <template #icon><n-icon :component="PlugDisconnected20Regular" /></template>
          断开
        </n-button>
      </div>

      <n-tabs v-model:value="store.tab" type="line" size="medium" class="ws-tabs">
        <n-tab-pane name="data" tab="数据" display-directive="show">
          <DataPane />
        </n-tab-pane>
        <n-tab-pane name="structure" tab="结构" display-directive="show">
          <StructurePane />
        </n-tab-pane>
        <n-tab-pane name="query" tab="查询" display-directive="show">
          <QueryPane />
        </n-tab-pane>
        <n-tab-pane name="dict" tab="字典" display-directive="show">
          <DictionaryPane />
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { NTabs, NTabPane, NBreadcrumb, NBreadcrumbItem, NTag, NButton, NIcon } from 'naive-ui'
import { Database20Regular, PlugDisconnected20Regular, PanelLeftContract20Regular, DocumentArrowDown16Regular } from '@vicons/fluent'
import Sidebar from './Sidebar.vue'
import DataPane from './DataPane.vue'
import StructurePane from './StructurePane.vue'
import QueryPane from './QueryPane.vue'
import DictionaryPane from './DictionaryPane.vue'
import { store } from '../store'

onMounted(async () => {
  if (!store.databases.length && store.connId) {
    store.databases = await window.api.databases(store.connId)
    if (store.databases.length && !store.currentDb) {
      store.currentDb = store.databases[0]
      store.tables = await window.api.tables(store.connId, store.currentDb)
    }
  }
})
const tableKey = computed(() => `${store.currentDb}.${store.currentTable}`)

async function importSql() {
  const filePath = await window.api.pickSqlFile()
  if (!filePath) return
  const res = await window.api.importSql(store.connId, store.currentDb, filePath)
  if (res.ok) {
    useMessage().success(`导入完成：${res.statements} 条语句 · ${res.elapsed.toFixed(2)}s`)
  } else {
    useMessage().error('导入失败：' + res.error)
  }
}

async function disconnect() {
  await window.api.disconnect(store.connId)
  store.phase = 'disconnected'
  store.connId = null
  store.databases = []
  store.tables = []
  store.currentDb = ''
  store.currentTable = ''
}
</script>

<style scoped>
.ws-root { flex: 1; display: flex; min-height: 0; overflow: hidden; }
.ws-sidebar { flex-shrink: 0; }
.ws-main { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 0 16px; overflow: hidden; }
.ws-toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 2px;
}
.ws-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ws-tabs :deep(.n-tabs-pane-wrapper) { flex: 1; min-height: 0; }
.ws-tabs :deep(.n-tab-pane) { height: 100%; padding: 8px 0 0; }
</style>
