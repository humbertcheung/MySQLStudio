<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    style="height: 100%"
  >
    <n-message-provider>
      <n-dialog-provider>
        <n-modal-provider>
          <div class="app-root">
            <!-- 自定义标题栏 -->
            <header class="titlebar titlebar-drag">
              <div class="traffic-spacer" />
              <div class="title-center">
                <span class="logo-dot brand-gradient" />
                <span class="title-text">MySQLStudio</span>
                <span v-if="store.phase === 'connected'" class="conn-chip titlebar-nodrag">
                  {{ store.config?.name }} · {{ store.config?.host }}:{{ store.config?.port }}
                </span>
              </div>
              <div class="title-actions titlebar-nodrag">
                <n-button quaternary size="tiny" @click="cycleTheme" :title="themeTitle">
                  <template #icon><n-icon :component="themeIcon" /></template>
                </n-button>
              </div>
            </header>

            <!-- 内容区 -->
            <main class="app-body">
              <ConnectionManager v-if="store.phase === 'disconnected'" />
              <Workspace v-else />
            </main>
          </div>
        </n-modal-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup>
import { computed, watch } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, NModalProvider, NButton, NIcon, darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { WeatherMoon16Regular, BrightnessHigh16Regular, System20Regular } from '@vicons/fluent'
import ConnectionManager from './components/ConnectionManager.vue'
import Workspace from './components/Workspace.vue'
import { store, setTheme } from './store'

const naiveTheme = computed(() => (effective.value === 'dark' ? darkTheme : null))

// 平台标记（Windows 上为系统窗口按钮让出右侧空间）
document.documentElement.dataset.platform = window.api?.platform || 'web'

const effective = computed(() => {
  if (store.theme !== 'system') return store.theme
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
})

watch(
  effective,
  (v) => {
    document.documentElement.className = `theme-${v}`
    // Windows 标题栏叠加层颜色跟随主题
    window.api?.setTitlebarTheme?.(v)
  },
  { immediate: true }
)

const themeIcon = computed(() => (store.theme === 'dark' ? WeatherMoon16Regular : store.theme === 'light' ? BrightnessHigh16Regular : System20Regular))
const themeTitle = computed(() => `主题：${{ dark: '暗色', light: '浅色', system: '跟随系统' }[store.theme]}（点击切换）`)

function cycleTheme() {
  setTheme({ dark: 'light', light: 'system', system: 'dark' }[store.theme])
}

const themeOverrides = computed(() => ({
  common: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
    fontFamilyMono: "'SF Mono', ui-monospace, Consolas, Menlo, monospace",
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    primaryColor: '#7C5CFC',
    primaryColorHover: '#8A6BFE',
    primaryColorPressed: '#6A4AE0',
    primaryColorSuppl: '#8A6BFE',
    errorColor: '#F04438',
    errorColorHover: '#F97066',
    errorColorPressed: '#D92D20',
    successColor: '#3DD68C',
    warningColor: '#FDB022',
    infoColor: '#7C5CFC'
  },
  DataTable: { borderRadius: '8px' },
  Card: { borderRadius: '12px' }
}))
</script>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-page);
}
.titlebar {
  height: 46px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 14px;
}
.traffic-spacer { width: 66px; }
.title-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.logo-dot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  display: inline-block;
}
.title-text {
  font-weight: 650;
  font-size: 13.5px;
  letter-spacing: 0.2px;
  color: var(--text-primary);
}
.conn-chip {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  padding: 2px 10px;
  border-radius: 999px;
}
.title-actions { display: flex; align-items: center; }
.app-body { flex: 1; min-height: 0; display: flex; }
</style>
