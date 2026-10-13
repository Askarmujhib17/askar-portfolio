import { handle } from '../../../server/ap-survey.js';
export const onRequest = ({ request, env }) => handle(request, env);
