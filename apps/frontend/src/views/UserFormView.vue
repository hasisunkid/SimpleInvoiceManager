<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  MIN_PASSWORD_LENGTH,
  checkPassword,
  isValidUsername,
  normalizeUsername,
} from '@sim/domain';
import type { Language } from '@sim/i18n';
import { api, type PublicUser, type Role } from '../api';
import LanguageSelect from '../components/LanguageSelect.vue';
import { useErrorText } from '../i18n';
import { session } from '../session';

/** FR-AUTH-04: create a user (no id) or edit, (de)activate and reset a user (with id). */
const props = defineProps<{ id?: number }>();

const { t } = useI18n();
const errorText = useErrorText();
const router = useRouter();

const isNew = computed(() => props.id === undefined);
const isSelf = computed(() => props.id !== undefined && props.id === session.user?.id);

const user = ref<PublicUser | null>(null);
const username = ref('');
const displayName = ref('');
const role = ref<Role>('USER');
const uiLanguage = ref<Language | null>(null);
const initialPassword = ref('');
const resetPassword = ref('');

const busy = ref(false);
const loading = ref(!isNew.value);
const submitted = ref(false);
const error = ref('');
const message = ref('');
const resetMessage = ref('');
const resetError = ref('');

const usernameInvalid = computed(() => !isValidUsername(normalizeUsername(username.value)));
const passwordInvalid = computed(() => checkPassword(initialPassword.value) !== null);
const formInvalid = computed(
  () =>
    displayName.value.trim() === '' ||
    (isNew.value && (usernameInvalid.value || passwordInvalid.value)),
);

function fill(u: PublicUser): void {
  user.value = u;
  displayName.value = u.displayName;
  role.value = u.role;
  uiLanguage.value = u.uiLanguage;
}

onMounted(async () => {
  if (isNew.value) return;
  try {
    fill(await api.get<PublicUser>(`users/${props.id}`));
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
});

async function save(): Promise<void> {
  submitted.value = true;
  error.value = message.value = '';
  if (formInvalid.value) return;
  busy.value = true;
  try {
    if (isNew.value) {
      const created = await api.post<PublicUser>('users', {
        username: normalizeUsername(username.value),
        displayName: displayName.value.trim(),
        role: role.value,
        uiLanguage: uiLanguage.value,
        password: initialPassword.value,
      });
      await router.replace({ name: 'user-edit', params: { id: created.id } });
      return;
    }
    fill(
      await api.patch<PublicUser>(`users/${props.id}`, {
        displayName: displayName.value.trim(),
        role: role.value,
        uiLanguage: uiLanguage.value,
      }),
    );
    message.value = t('common.saved');
  } catch (err) {
    error.value = errorText(err);
  } finally {
    busy.value = false;
  }
}

async function setActive(active: boolean): Promise<void> {
  if (!user.value) return;
  // NFR-UX-03: destructive actions need confirmation.
  if (!active && !window.confirm(t('users.confirmDeactivate', { name: user.value.displayName }))) {
    return;
  }
  error.value = message.value = '';
  try {
    fill(await api.patch<PublicUser>(`users/${props.id}`, { active }));
    message.value = t('common.saved');
  } catch (err) {
    error.value = errorText(err);
  }
}

async function reset(): Promise<void> {
  resetError.value = resetMessage.value = '';
  if (checkPassword(resetPassword.value) !== null) {
    resetError.value = t('password.tooShort', { min: MIN_PASSWORD_LENGTH });
    return;
  }
  try {
    fill(
      await api.put<PublicUser>(`users/${props.id}/password`, { newPassword: resetPassword.value }),
    );
    resetPassword.value = '';
    resetMessage.value = t('users.resetDone');
  } catch (err) {
    resetError.value = errorText(err);
  }
}
</script>

<template>
  <main class="page">
    <RouterLink :to="{ name: 'users' }" class="back-link">{{ t('common.back') }}</RouterLink>
    <h1>{{ isNew ? t('users.new') : t('users.edit') }}</h1>

    <p v-if="loading" class="hint">{{ t('common.loading') }}</p>

    <template v-else>
      <form class="card" novalidate @submit.prevent="save">
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <p v-if="message" class="notice" role="status">{{ message }}</p>

        <template v-if="isNew">
          <label for="u-username">{{ t('users.username') }}</label>
          <input
            id="u-username"
            v-model="username"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            aria-describedby="u-username-hint"
            :aria-invalid="submitted && usernameInvalid"
            required
          />
          <small id="u-username-hint" class="hint">{{ t('users.usernameHint') }}</small>
        </template>
        <dl v-else-if="user" class="facts">
          <dt>{{ t('users.username') }}</dt>
          <dd>{{ user.username }}</dd>
          <dt>{{ t('users.status') }}</dt>
          <dd>{{ user.active ? t('users.active') : t('users.inactive') }}</dd>
        </dl>

        <label for="u-name">{{ t('users.displayName') }}</label>
        <input
          id="u-name"
          v-model="displayName"
          autocomplete="off"
          :aria-invalid="submitted && displayName.trim() === ''"
          required
        />

        <label for="u-role">{{ t('users.role') }}</label>
        <select id="u-role" v-model="role">
          <option value="USER">{{ t('roles.USER') }}</option>
          <option value="ADMIN">{{ t('roles.ADMIN') }}</option>
        </select>

        <label for="u-language">{{ t('users.language') }}</label>
        <LanguageSelect id="u-language" v-model="uiLanguage" allow-browser />

        <template v-if="isNew">
          <label for="u-password">{{ t('users.initialPassword') }}</label>
          <input
            id="u-password"
            v-model="initialPassword"
            type="text"
            autocomplete="off"
            aria-describedby="u-password-hint"
            :aria-invalid="submitted && passwordInvalid"
            required
          />
          <small id="u-password-hint" class="hint">
            {{ t('password.hint', { min: MIN_PASSWORD_LENGTH }) }}
            {{ t('users.initialPasswordHint') }}
          </small>
        </template>

        <p v-if="submitted && formInvalid" class="alert" role="alert">
          {{ t('errors.VALIDATION_FAILED') }}
        </p>

        <button type="submit" class="primary" :disabled="busy">
          {{ busy ? t('common.saving') : isNew ? t('users.create') : t('common.save') }}
        </button>
      </form>

      <template v-if="user && !isSelf">
        <form class="card" novalidate @submit.prevent="reset">
          <h2>{{ t('users.resetTitle') }}</h2>
          <p class="hint">{{ t('users.resetHint') }}</p>
          <p v-if="resetError" class="alert" role="alert">{{ resetError }}</p>
          <p v-if="resetMessage" class="notice" role="status">{{ resetMessage }}</p>
          <label for="u-reset">{{ t('password.new') }}</label>
          <input id="u-reset" v-model="resetPassword" type="text" autocomplete="off" required />
          <button type="submit" class="secondary">{{ t('users.resetSubmit') }}</button>
        </form>

        <section class="card">
          <h2>{{ t('users.status') }}</h2>
          <button v-if="user.active" type="button" class="danger" @click="setActive(false)">
            {{ t('users.deactivate') }}
          </button>
          <button v-else type="button" class="secondary" @click="setActive(true)">
            {{ t('users.reactivate') }}
          </button>
        </section>
      </template>
    </template>
  </main>
</template>
