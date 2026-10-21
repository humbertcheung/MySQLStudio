<template>
  <div class="conn-root">
    <!-- 左：连接列表 -->
    <aside class="conn-list">
      <div class="list-head">
        <span class="list-title">连接</span>
        <n-button size="tiny" quaternary @click="startCreate">
          <template #icon><n-icon :component="Add16Regular" /></template>
        </n-button>
      </div>
      <div
        v-for="c in configs"
        :key="c.id"
        class="conn-item"
        :class="{ active: current?.id === c.id }"
        @click="select(c)"
      >
        <div class="item-icon brand-gradient">{{ (c.name || '?')[0].toUpperCase() }}</div>
        <div class="item-meta">
          <div class="item-name">{{ c.name }}</div>
          <div class="item-sub">{{ c.username }}@{{ c.host }}:{{ c.port }}</div>
        </div>
      </div>
      <div v-if="!configs.length" class="list-empty">尚无连接，点击 + 新建</div>
    </aside>

    <!-- 右：表单 -->
    <section class="conn-form">
      <template v-if="showForm">
        <div class="form-card card">
          <div class="brand-row">
            <div class="brand-icon brand-gradient">
              <n-icon size="26" color="#fff" :component="Database20Regular" />
            </div>
            <div>
              <div class="form-title">连接配置</div>
              <div class="form-sub">MySQL · {{ form.host || '未设置主机' }}</div>
            </div>
          </div>

          <div class="grid-form">
            <label>名称</label>
            <n-input v-model:value="form.name" placeholder="Local MySQL" />
            <label>主机</label>
            <n-input v-model:value="form.host" placeholder="127.0.0.1" />
            <label>端口</label>
            <n-input-number v-model:value="form.port" :min="1" :max="65535" :show-button="false" />
            <label>用户名</label>
            <n-input v-model:value="form.username" placeholder="root" />
            <label>密码</label>
            <n-input v-model:value="form.password" type="password" show-password-on="click" placeholder="••••••" />
            <label></label>
            <n-checkbox v-model:checked="rememberPassword" size="small" title="勾选后密码会保存到本机连接配置中">
              记住密码（保存到本机，方便下次直接连接）
            </n-checkbox>
            <label>数据库</label>
            <n-input v-model:value="form.database" placeholder="可留空" />
          </div>

          <div v-if="testResult" class="test-line" :class="testResult.ok ? 'ok' : 'bad'">
            <n-icon :component="testResult.ok ? CheckmarkCircle16Regular : ErrorCircle16Regular" />
            <span>{{ testResult.ok ? `连接成功 · MySQL ${testResult.serverVersion}` : testResult.error }}</span>
          </div>

          <div class="btn-row">
            <n-button :loading="testing" @click="doTest" style="flex: 1">
              测试连接
            </n-button>
            <n-button type="primary" :loading="connecting" @click="doConnect" style="flex: 2">
              <template #icon><n-icon :component="ArrowRight16Regular" /></template>
              连接
            </n-button>
          </div>
        </div>
      </template>

      <div v-else class="empty-state">
        <n-icon size="52" :component="Database20Regular" style="opacity: 0.35" />
        <div style="font-size: 15px; color: var(--text-secondary)">选择或新建一个连接</div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import {
  NButton, NInput, NInputNumber, NIcon, NCheckbox, useMessage
} from 'naive-ui'
import { Add16Regular, CheckmarkCircle16Regular, ErrorCircle16Regular, ArrowRight16Regular, Database20Regular } from '@vicons/fluent'
import { store } from '../store'

const message = useMessage()
const configs = ref([])
const current = ref(null)
const form = ref({})
const testing = ref(false)
const connecting = ref(false)
const testResult = ref(null)
const showForm = ref(false)
const rememberPassword = ref(true)

onMounted(async () => {
  configs.value = await window.api.listConfigs()
  if (configs.value.length) select(configs.value[0])
  else startCreate()
})

function startCreate() {
  current.value = null
  showForm.value = true
  testResult.value = null
  form.value = { name: 'Local MySQL', host: '127.0.0.1', port: 3306, username: 'root', password: '123456', database: '' }
}

function select(c) {
  current.value = c
  showForm.value = true
  form.value = { ...c }
  // 有保存过密码 → 勾选"记住密码"
  rememberPassword.value = !!c.password
  testResult.value = null
}

async function persist() {
  // 未勾选"记住密码"时，保存的配置里不保留密码
  const payload = { ...form.value, id: current.value?.id }
  if (!rememberPassword.value) payload.password = ''
  const saved = await window.api.saveConfig(JSON.parse(JSON.stringify(payload)))
  configs.value = saved
  const again = saved.find((c) => c.id === (current.value?.id) || (c.host === form.value.host && c.name === form.value.name))
  if (again) { current.value = again; form.value = { ...again } }
}

async function doTest() {
  testing.value = true
  testResult.value = await window.api.test({ ...form.value })
  testing.value = false
}

async function doConnect() {
  connecting.value = true
  let res
  try {
    res = await window.api.connect({ ...form.value })
  } catch (e) {
    res = { ok: false, error: 'IPC 调用失败: ' + e.message }
  } finally {
    connecting.value = false
  }
  if (!res.ok) {
    testResult.value = { ok: false, error: res.error }
    return
  }
  await persist()
  store.connId = res.connId
  store.serverVersion = res.serverVersion
  store.config = { ...form.value }
  store.phase = 'connected'
  message.success(`已连接 MySQL ${res.serverVersion}`)
}
</script>

<style scoped>
.conn-root { flex: 1; display: flex; min-height: 0; }

.conn-list {
  width: 250px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}
.list-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 2px 4px 8px;
}
.list-title {
  font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
  color: var(--text-tertiary); text-transform: uppercase;
}
.conn-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: var(--radius-m);
  cursor: pointer; transition: background .15s;
}
.conn-item:hover { background: var(--bg-hover); }
.conn-item.active { background: var(--accent-subtle); }
.item-icon {
  width: 34px; height: 34px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 15px; flex-shrink: 0;
}
.item-name { font-weight: 550; font-size: 13.5px; }
.item-sub {
  font-size: 11.5px; color: var(--text-tertiary);
  font-family: var(--font-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 165px;
}
.list-empty { color: var(--text-tertiary); font-size: 12.5px; text-align: center; padding: 20px 0; }

.conn-form {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 30px;
  background:
    radial-gradient(900px 380px at 50% -80px, var(--accent-subtle), transparent 70%),
    var(--bg-page);
}
.form-card { width: 460px; padding: 28px; }
.brand-row { display: flex; gap: 14px; align-items: center; margin-bottom: 24px; }
.brand-icon {
  width: 48px; height: 48px; border-radius: 13px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px rgba(124, 92, 252, 0.35);
}
.form-title { font-size: 18px; font-weight: 700; }
.form-sub { font-size: 12.5px; color: var(--text-tertiary); font-family: var(--font-mono); }

.grid-form {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 13px 14px;
  align-items: center;
}
.grid-form label {
  text-align: right; font-size: 13px; color: var(--text-secondary);
}

.test-line {
  margin-top: 18px; padding: 10px 12px; border-radius: var(--radius-m);
  display: flex; align-items: center; gap: 8px; font-size: 13px;
}
.test-line.ok { background: rgba(61, 214, 140, 0.1); color: var(--success-text); }
.test-line.bad { background: rgba(240, 68, 56, 0.1); color: var(--danger-solid); }

.btn-row { display: flex; gap: 10px; margin-top: 18px; }
.btn-row .n-button { height: 40px; font-weight: 600; }
</style>
