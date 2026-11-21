<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type Customer, type CustomerPage } from '../api';
import { useCustomerForm } from '../composables/useCustomerForm';
import { useDebounced } from '../composables/useDebounced';
import { useErrorText } from '../i18n';
import CustomerFields from './CustomerFields.vue';

/**
 * Customer selection for the invoice editor (US #5): search as you type (FR-CUST-02) or
 * quick-create with name and address only (FR-CUST-05). Emits the chosen customer.
 */
const props = defineProps<{ modelValue: Customer | null }>();
const emit = defineEmits<{ 'update:modelValue': [customer: Customer | null] }>();

const { t } = useI18n();
const errorText = useErrorText();

const query = ref('');
const debounced = useDebounced(query);
const results = ref<Customer[]>([]);
const searching = ref(false);
const creating = ref(false);
const busy = ref(false);
const error = ref('');
const quick = useCustomerForm();

async function search(q: string): Promise<void> {
  searching.value = true;
  try {
    const page = await api.get<CustomerPage>(`customers?limit=20&q=${encodeURIComponent(q)}`);
    // Ignore late answers for an outdated query.
    if (q === debounced.value) results.value = page.items;
  } catch (err) {
    error.value = errorText(err);
  } finally {
    searching.value = false;
  }
}

watch(debounced, (q) => void search(q), { immediate: true });

function choose(customer: Customer): void {
  emit('update:modelValue', customer);
  query.value = '';
  creating.value = false;
}

function startCreate(): void {
  creating.value = true;
  // Prefill the name with what was typed into the search.
  quick.reset({ ...quick.payload(), contactPerson: query.value.trim(), companyName: '' });
}

async function create(): Promise<void> {
  quick.submitted.value = true;
  error.value = '';
  if (!quick.valid.value) return;
  busy.value = true;
  try {
    choose(await api.post<Customer>('customers', quick.payload()));
  } catch (err) {
    quick.serverError(err);
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="picker">
    <div v-if="props.modelValue" class="picker__selected">
      <span class="hint">{{ t('customers.selected') }}</span>
      <strong>{{ props.modelValue.displayName }}</strong>
      <span class="list__sub">
        {{
          [props.modelValue.street, `${props.modelValue.zip} ${props.modelValue.city}`.trim()]
            .filter(Boolean)
            .join(', ')
        }}
      </span>
      <button type="button" class="link-button" @click="emit('update:modelValue', null)">
        {{ t('customers.change') }}
      </button>
    </div>

    <template v-else-if="!creating">
      <label for="picker-search">{{ t('customers.searchLabel') }}</label>
      <input
        id="picker-search"
        v-model="query"
        type="search"
        :placeholder="t('customers.searchPlaceholder')"
        autocomplete="off"
        enterkeyhint="search"
      />
      <ul class="list picker__results" :aria-busy="searching">
        <li v-for="customer in results" :key="customer.id">
          <button type="button" class="list__item list__button" @click="choose(customer)">
            <span class="list__title">{{ customer.displayName }}</span>
            <span class="list__sub">{{
              [customer.zip, customer.city].filter(Boolean).join(' ')
            }}</span>
          </button>
        </li>
      </ul>
      <p v-if="!searching && results.length === 0" class="hint">{{ t('common.noResults') }}</p>
      <button type="button" class="secondary" @click="startCreate">{{ t('customers.new') }}</button>
    </template>

    <form v-else class="stack" novalidate @submit.prevent="create">
      <h3>{{ t('customers.quickTitle') }}</h3>
      <p class="hint">{{ t('customers.quickHint') }}</p>
      <CustomerFields
        id-prefix="quick"
        :form="quick.form"
        :errors="quick.errors.value"
        compact
        @touch="(field) => quick.touched.add(field)"
      />
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <button type="submit" class="primary" :disabled="busy">
        {{ busy ? t('common.saving') : t('customers.quickCreate') }}
      </button>
      <button type="button" class="link-button" @click="creating = false">
        {{ t('common.cancel') }}
      </button>
    </form>
  </div>
</template>
