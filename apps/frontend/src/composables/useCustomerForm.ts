import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { validateCustomer, type CustomerData, type CustomerField } from '@sim/domain';
import { ApiError } from '../api';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function emptyCustomer(): Mutable<CustomerData> {
  return {
    type: 'PRIVATE',
    companyName: '',
    contactPerson: '',
    street: '',
    zip: '',
    city: '',
    countryCode: 'DE',
    email: '',
    phone: '',
    vatId: '',
    invoiceLanguage: 'de',
    notes: '',
  };
}

/**
 * Form state with client-side validation (same rules as the server, from @sim/domain) and
 * server-reported field errors. Errors show after a field was left or the form was submitted.
 */
export function useCustomerForm(initial: CustomerData = emptyCustomer()) {
  const { t } = useI18n();
  const form = reactive<Mutable<CustomerData>>({ ...initial });
  const touched = reactive(new Set<CustomerField>());
  const submitted = ref(false);
  const serverFields = ref<Record<string, string>>({});

  const problems = computed(() =>
    validateCustomer({ ...form, countryCode: form.countryCode.toUpperCase() }),
  );
  const valid = computed(() => Object.keys(problems.value).length === 0);

  const errors = computed(() => {
    const result: Partial<Record<CustomerField, string>> = {};
    for (const [field, code] of Object.entries({ ...problems.value, ...serverFields.value })) {
      if (submitted.value || touched.has(field as CustomerField)) {
        result[field as CustomerField] = t(`errors.${code}`);
      }
    }
    return result;
  });

  function reset(data: CustomerData): void {
    Object.assign(form, data);
    touched.clear();
    submitted.value = false;
    serverFields.value = {};
  }

  function serverError(err: unknown): void {
    if (err instanceof ApiError) serverFields.value = { ...err.fields };
  }

  /** The body sent to the API. */
  function payload(): CustomerData {
    return { ...form, countryCode: form.countryCode.trim().toUpperCase() };
  }

  return { form, touched, submitted, valid, errors, reset, serverError, payload };
}
