<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Language } from '@sim/i18n';
import { api, type PublicUser } from '../api';
import LanguageSelect from '../components/LanguageSelect.vue';
import PasswordChangeForm from '../components/PasswordChangeForm.vue';
import { applyLanguage, browserLanguage, useErrorText } from '../i18n';
import { session, setCurrentUser } from '../session';

/** FR-AUTH-05: own UI language and password. */
const { t, locale } = useI18n();
const errorText = useErrorText();

const language = ref<Language | null>(session.user?.uiLanguage ?? null);
const message = ref('');
const error = ref('');

async function saveLanguage(value: Language | null): Promise<void> {
  const previous = language.value;
  language.value = value;
  message.value = error.value = '';
  try {
    const user = await api.put<PublicUser>('me/language', { uiLanguage: value });
    setCurrentUser(user);
    applyLanguage(locale, value ?? browserLanguage());
    message.value = t('profile.languageSaved');
  } catch (err) {
    language.value = previous;
    error.value = errorText(err);
  }
}
</script>

<template>
  <main class="page">
    <h1>{{ t('profile.title') }}</h1>

    <section class="card">
      <h2>{{ t('profile.account') }}</h2>
      <dl class="facts">
        <dt>{{ t('users.displayName') }}</dt>
        <dd>{{ session.user?.displayName }}</dd>
        <dt>{{ t('users.username') }}</dt>
        <dd>{{ session.user?.username }}</dd>
        <dt>{{ t('users.role') }}</dt>
        <dd>{{ session.user ? t(`roles.${session.user.role}`) : '' }}</dd>
      </dl>

      <label for="profile-language">{{ t('language.label') }}</label>
      <LanguageSelect
        id="profile-language"
        :model-value="language"
        allow-browser
        @update:model-value="saveLanguage"
      />
      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
    </section>

    <PasswordChangeForm />
  </main>
</template>
