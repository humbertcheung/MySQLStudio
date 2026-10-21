<template>
  <n-modal v-model:show="show" preset="card" title="新建表" style="width: 980px">
    <div class="ct-body">
      <div class="ct-row">
        <n-input v-model:value="tableName" placeholder="表名" style="width: 240px" />
        <n-select v-model:value="engine" :options="engineOptions" style="width: 150px" />
        <n-select v-model:value="charset" :options="charsetOptions" style="width: 170px" filterable />
        <n-input v-model:value="comment" placeholder="表注释（可选）" style="flex: 1" />
      </div>

      <div class="ct-cols-head">
        <span>列定义</span>
        <div style="flex: 1" />
        <n-button size="tiny" secondary type="primary" @click="addCol">
          <template #icon><n-icon :component="Add16Regular" /></template>
          添加列
        </n-button>
      </div>

      <div class="ct-cols">
        <div class="ct-col-row ct-col-header">
          <span>列名</span><span>类型</span><span>长度</span><span>可空</span>
          <span>主键</span><span>自增</span><span>默认值</span><span>注释</span><span></span>
        </div>
        <div v-for="(col, i) in columns" :key="i" class="ct-col-row">
          <n-input v-model:value="col.name" size="small" placeholder="列名" />
          <n-select v-model:value="col.type" size="small" :options="typeOptions" filterable />
          <n-input v-model:value="col.length" size="small" placeholder="长度" />
          <n-checkbox v-model:checked="col.nullable" size="small" />
          <n-checkbox v-model:checked="col.isPk" size="small" />
          <n-checkbox v-model:checked="col.autoIncrement" size="small" />
          <n-input v-model:value="col.defaultValue" size="small" placeholder="默认值" />
          <n-input v-model:value="col.comment" size="small" placeholder="注释" />
          <n-button size="tiny" quaternary type="error" @click="columns.splice(i, 1)">
            <template #icon><n-icon :component="Delete16Regular" /></template>
          </n-button>
        </div>
      </div>
    </div>

    <template #footer>
      <div style="display: flex; justify-content: flex-end; gap: 10px">
        <n-button @click="show = false">取消</n-button>
        <n-button type="primary" :loading="loading" :disabled="!tableName.trim() || !columns.length" @click="submit">
          创建表
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  NModal, NInput, NSelect, NButton, NIcon, NCheckbox, useMessage
} from 'naive-ui'
import { Add16Regular, Delete16Regular } from '@vicons/fluent'
import { store } from '../store'

const props = defineProps({ database: { type: String, default: '' } })
const emit = defineEmits(['created'])
const message = useMessage()

const show = ref(false)
const loading = ref(false)
const tableName = ref('')
const engine = ref('InnoDB')
const charset = ref('utf8mb4')
const comment = ref('')
const charsets = ref([])

const engineOptions = [
  { label: 'InnoDB', value: 'InnoDB' },
  { label: 'MyISAM', value: 'MyISAM' },
  { label: 'MEMORY', value: 'MEMORY' }
]
const charsetOptions = computed(() => charsets.value.map((c) => ({ label: c.name, value: c.name })))

const typeOptions = [
  'INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'MEDIUMINT',
  'DECIMAL', 'FLOAT', 'DOUBLE',
  'VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BLOB', 'JSON', 'ENUM', 'SET'
].map((t) => ({ label: t, value: t }))

const columns = ref([])

function newColumn() {
  return { name: '', type: 'VARCHAR', length: '255', nullable: true, isPk: false, autoIncrement: false, defaultValue: '', comment: '' }
}

function addCol() {
  columns.value.push(newColumn())
}

async function open() {
  show.value = true
  tableName.value = ''
  comment.value = ''
  columns.value = [{ name: 'id', type: 'INT', length: '', nullable: false, isPk: true, autoIncrement: true, defaultValue: '', comment: '' }, newColumn()]
  if (!charsets.value.length) {
    const res = await window.api.charsets(store.connId)
    charsets.value = res.charsets
  }
}

async function submit() {
  loading.value = true
  try {
    await window.api.createTable(store.connId, props.database, {
      name: tableName.value.trim(),
      engine: engine.value,
      charset: charset.value,
      comment: comment.value,
      columns: columns.value.map((c) => ({
        name: c.name.trim(),
        type: c.type,
        length: c.length && !['TEXT', 'BLOB', 'JSON', 'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'].includes(c.type) ? c.length : '',
        nullable: c.nullable,
        key: c.isPk ? 'PRI' : '',
        autoIncrement: c.autoIncrement,
        defaultValue: c.defaultValue,
        comment: c.comment
      }))
    })
    message.success(`已创建表 ${tableName.value}`)
    show.value = false
    emit('created')
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
.ct-body { display: flex; flex-direction: column; gap: 14px; }
.ct-row { display: flex; gap: 10px; align-items: center; }
.ct-cols-head { display: flex; align-items: center; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.ct-cols { display: flex; flex-direction: column; gap: 6px; max-height: 380px; overflow-y: auto; padding-right: 4px; }
.ct-col-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 0.7fr 46px 46px 46px 1fr 1fr 32px;
  gap: 6px;
  align-items: center;
}
.ct-col-header { font-size: 12px; color: var(--text-tertiary); padding: 0 2px; }
.ct-col-header span { text-align: center; }
</style>
