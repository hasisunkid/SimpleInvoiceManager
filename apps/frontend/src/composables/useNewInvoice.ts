import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type Invoice } from '../api';
import { useErrorText } from '../i18n';

/** FR-INV-22 / US #5: one tap creates a draft and opens the editor. */
export function useNewInvoice() {
  const router = useRouter();
  const errorText = useErrorText();
  const creating = ref(false);
  const error = ref('');

  async function create(customerId: number | null = null): Promise<void> {
    if (creating.value) return;
    creating.value = true;
    error.value = '';
    try {
      const invoice = await api.post<Invoice>('invoices', customerId ? { customerId } : {});
      await router.push({ name: 'invoice-edit', params: { id: invoice.id } });
    } catch (err) {
      error.value = errorText(err);
    } finally {
      creating.value = false;
    }
  }

  return { create, creating, error };
}
