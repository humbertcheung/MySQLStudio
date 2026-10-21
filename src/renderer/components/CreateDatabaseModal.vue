<template>
  <n-modal v-model:show="show" preset="card" title="新建数据库" style="width: 460px">
    <n-form label-placement="left" label-width="88" size="medium">
      <n-form-item label="数据库名">
        <n-input v-model:value="name" placeholder="mydb" autofocus @keyup.enter="submit" />
      </n-form-item>
      <n-form-item label="字符集">
        <n-select
          v-model:value="charset"
          :options="charsetOptions"
          filterable
          @update:value="onCharsetChange"
        />
      </n-form-item>
      <n-form-item label="排序规则">
        <n-select v-model:value="collation" :options="collationOptions" filterable />
      </n-form-item>
    </n-form>
    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 10px">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :loading="loading" :disabled="!name.trim()" @click="submit">创建</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, ref } from 'vue'
import { NModal, NForm, NFormItem, NInput, NSelect, NButton, useMessage } from 'naive-ui'
import { store } from '../store'

const emit = defineEmits(['created'])
const message = useMessage()

const show = ref(false)
const name = ref('')
const charset = ref('utf8mb4')
const collation = ref('utf8mb4_general_ci')
const loading = ref(false)
const charsets = ref([])
const collations = ref([])

const charsetOptions = computed(() =>
  charsets.value.map((c) => ({ label: `${c.name} — ${c.desc}`, value: c.name }))
)
const collationOptions = computed(() =>
  collations.value.filter((c) => c.charset === charset.value).map((c) => ({
    label: c.name + (c.isDefault ? '（默认）' : ''),
    value: c.name
  }))
)

async function open() {
  name.value = ''
  loading.value = false
  show.value = true
  if (!charsets.value.length) {
    const res = await window.api.charsets(store.connId)
    charsets.value = res.charsets
    collations.value = res.collations
    const def = res.charsets.find((c) => c.name === 'utf8mb4')
    if (def) {
      charset.value = 'utf8mb4'
      collation.value = def.defaultCollation
    }
  }
}

function onCharsetChange(v) {
  const def = collations.value.find((c) => c.charset === v && c.isDefault)
  if (def) collation.value = def.name
}

async function submit() {
  if (!name.value.trim()) return
  loading.value = true
  try {
    await window.api.createDatabase(store.connId, name.value.trim(), charset.value, collation.value)
    message.success(`已创建 ${name.value}`)
    show.value = false
    emit('created', name.value.trim())
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>
