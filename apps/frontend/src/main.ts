import { createApp } from 'vue';
import App from './App.vue';
import { createAppI18n } from './i18n';
import { createAppRouter } from './router';
import './styles.css';

const i18n = createAppI18n();
document.documentElement.lang = i18n.global.locale.value;

createApp(App).use(i18n).use(createAppRouter()).mount('#app');
