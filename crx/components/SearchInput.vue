<template>
  <div class="search-input">
    <input
      type="text"
      :value="modelValue"
      @input="onInput"
      @compositionend="onCompositionEnd"
      placeholder="搜索你的浏览历史..."
      autofocus
    />
    <button v-if="modelValue" class="clear-btn" @click="$emit('update:modelValue', '')">✕</button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

let isComposing = false;

function onInput(e: Event) {
  if (isComposing) return;
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}

function onCompositionEnd(e: Event) {
  isComposing = false;
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
</script>

<style scoped>
.search-input {
  display: flex;
  align-items: center;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 4px 8px;
  background: #fff;
}

.search-input:focus-within {
  border-color: #4a90d9;
  box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.2);
}

input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  padding: 6px 4px;
  background: transparent;
}

.clear-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  line-height: 1;
}

.clear-btn:hover {
  color: #333;
}
</style>
