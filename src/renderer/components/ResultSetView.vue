<template>
  <div class="result-set">
    <div class="result-meta" v-if="rs.columns.length">
      {{ rs.rows.length }} 行
    </div>
    <n-scrollbar v-if="rs.columns.length" class="result-grid-scroll">
      <table class="rs-table">
        <thead>
          <tr>
            <th v-for="c in rs.columns" :key="c">{{ c }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in rs.rows" :key="ri">
            <td v-for="(v, ci) in row" :key="ci">
              <span v-if="v === null" class="rs-null">NULL</span>
              <span v-else>{{ v }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </n-scrollbar>
    <div v-else class="rs-affected">
      <n-icon :component="CheckmarkCircle16Regular" size="18" />
      执行成功 · 影响 {{ rs.affected }} 行
    </div>
  </div>
</template>

<script setup>
import { NIcon, NScrollbar } from 'naive-ui'
import { CheckmarkCircle16Regular } from '@vicons/fluent'

defineProps({ rs: { type: Object, required: true } })
</script>
