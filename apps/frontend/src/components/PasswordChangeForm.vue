<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { MIN_PASSWORD_LENGTH, checkPassword } from '@sim/domain';
import { api, type PublicUser } from '../api';
import { useErrorText } from '../i18n';
import { setCurrentUser } from '../session';

const emit = defineEmits<{ changed: [user: PublicUser] }>();

const { t } = useI18n();
const errorText = useErrorText();

const currentPassword = ref('');
const newPassword = ref('');
const repeatPassword = ref('');
const busy = ref(false);
const error = ref('');
const success = ref(false);
const submitted = ref(false);

const problem = computed(() => {
  if (checkPassword(newPassword.value) === 'TOO_SHORT') {
    return t('password.tooShort', { min: MIN_PASSWORD_LENGTH });
  }
  if (repeatPassword.value !== newPassword.value) return t('password.mismatch');
  return '';
});

async function submit(): Promise<void> {
  submitted.value = true;
  error.value = '';
  success.value = false;
  if (problem.value) return;
  busy.value = true;
  try {
    const user = await api.put<PublicUser>('me/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    });
    setCurrentUser(user);
    currentPassword.value = newPassword.value = repeatPassword.value = '';
    submitted.value = false;
    success.value = true;
    emit('changed', user);
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card" novalidate @submit.prevent="submit">
    <h2>{{ t('password.changeTitle') }}</h2>
    <slot />

    <p v-if="error" class="alert" role="alert">{{ error }}</p>
    <p v-if="success" class="notice" role="status">{{ t('password.changed') }}</p>

    <label for="pw-current">{{ t('password.current') }}</label>
    <input
      id="pw-current"
      v-model="currentPassword"
      type="password"
      autocomplete="current-password"
      required
    />

    <label for="pw-new">{{ t('password.new') }}</label>
    <input
      id="pw-new"
      v-model="newPassword"
      type="password"
      autocomplete="new-password"
      aria-describedby="pw-hint"
      required
    />
    <small id="pw-hint" class="hint">{{ t('password.hint', { min: MIN_PASSWORD_LENGTH }) }}</small>

    <label for="pw-repeat">{{ t('password.repeat') }}</label>
    <input
      id="pw-repeat"
      v-model="repeatPassword"
      type="password"
      autocomplete="new-password"
      required
    />

    <p v-if="submitted && problem" class="alert" role="alert">{{ problem }}</p>

    <button type="submit" class="primary" :disabled="busy">
      {{ busy ? t('common.saving') : t('password.submit') }}
    </button>
  </form>
</template>
