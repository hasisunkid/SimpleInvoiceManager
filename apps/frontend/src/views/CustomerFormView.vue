<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, type Customer } from '../api';
import CustomerFields from '../components/CustomerFields.vue';
import { useCustomerForm } from '../composables/useCustomerForm';
import { useErrorText } from '../i18n';

/** FR-CUST-01, -03, -04: create or edit a customer; archive or delete it. */
const props = defineProps<{ id?: number }>();

const { t } = useI18n();
const errorText = useErrorText();
const router = useRouter();
const { form, touched, submitted, valid, errors, reset, serverError, payload } = useCustomerForm();

const isNew = computed(() => props.id === undefined);
const customer = ref<Customer | null>(null);
const loading = ref(!isNew.value);
const busy = ref(false);
const error = ref('');
const message = ref('');

onMounted(async () => {
  if (isNew.value) return;
  try {
    customer.value = await api.get<Customer>(`customers/${props.id}`);
    reset(customer.value);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  error.value = message.value = '';
  if (!valid.value) {
    error.value = t('errors.VALIDATION_FAILED');
    return;
  }
  busy.value = true;
  try {
    if (isNew.value) {
      const created = await api.post<Customer>('customers', payload());
      await router.replace({ name: 'customer-edit', params: { id: created.id } });
      return;
    }
    customer.value = await api.put<Customer>(`customers/${props.id}`, payload());
    reset(customer.value);
    message.value = t('customers.saved');
  } catch (err) {
    serverError(err);
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function setArchived(archived: boolean): Promise<void> {
  error.value = message.value = '';
  try {
    customer.value = await api.put<Customer>(`customers/${props.id}/archived`, { archived });
  } catch (err) {
    error.value = errorText(err);
  }
}

async function remove(): Promise<void> {
  if (!customer.value) return;
  // NFR-UX-03: destructive actions need confirmation.
  if (!window.confirm(t('customers.confirmDelete', { name: customer.value.displayName }))) return;
  error.value = '';
  try {
    await api.delete(`customers/${props.id}`);
    await router.replace({ name: 'customers' });
  } catch (err) {
    error.value = errorText(err);
  }
}
</script>

<template>
  <main class="page">
    <RouterLink :to="{ name: 'customers' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <h1>{{ isNew ? t('customers.new') : t('customers.edit') }}</h1>

    <p v-if="loading" class="hint">{{ t('common.loading') }}</p>

    <template v-else-if="isNew || customer">
      <p v-if="customer?.archived" class="alert" role="status">
        {{ t('customers.archivedNotice') }}
      </p>

      <form class="card" novalidate @submit.prevent="save">
        <CustomerFields
          id-prefix="customer"
          :form="form"
          :errors="errors"
          @touch="(field) => touched.add(field)"
        />
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="message" class="notice" role="status">{{ message }}</p>
        <button type="submit" class="primary" :disabled="busy">
          {{ busy ? t('common.saving') : t('common.save') }}
        </button>
      </form>

      <template v-if="customer">
        <!-- FR-CUST-03: invoices of this customer – filled in once invoices exist (M4). -->
        <section class="card">
          <h2>{{ t('customers.invoices') }}</h2>
          <p class="hint">{{ t('customers.noInvoices') }}</p>
        </section>

        <section class="card">
          <p class="hint">{{ t('customers.archiveHint') }}</p>
          <button
            v-if="!customer.archived"
            type="button"
            class="secondary"
            @click="setArchived(true)"
          >
            {{ t('customers.archive') }}
          </button>
          <button v-else type="button" class="secondary" @click="setArchived(false)">
            {{ t('customers.unarchive') }}
          </button>
          <button type="button" class="danger" @click="remove">{{ t('customers.delete') }}</button>
        </section>
      </template>
    </template>
    <p v-else-if="error" class="alert" role="alert">{{ error }}</p>
  </main>
</template>
