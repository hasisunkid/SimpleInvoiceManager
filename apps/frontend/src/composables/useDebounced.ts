import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/** A ref that follows `source` after `delayMs` of quiet – for search as you type. */
export function useDebounced<T>(source: Ref<T>, delayMs = 250): Ref<T> {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(source, (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => (debounced.value = value), delayMs);
  });
  onBeforeUnmount(() => clearTimeout(timer));
  return debounced;
}
