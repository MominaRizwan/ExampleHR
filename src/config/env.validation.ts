import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_TYPE: Joi.string().valid('sqlite').default('sqlite'),
  DB_PATH: Joi.string().default('data/time-off.sqlite'),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  HCM_INTEGRATION_MODE: Joi.string().valid('mock', 'api').default('mock'),
  HCM_BASE_URL: Joi.string().uri().required(),
  HCM_API_TIMEOUT_MS: Joi.number().integer().min(500).default(5000),
  HCM_API_MAX_RETRIES: Joi.number().integer().min(1).max(3).default(3),
  HCM_MOCK_RANDOM_FAILURE_RATE: Joi.number().min(0).max(1).default(0.15),
  HCM_MOCK_DELAY_MS: Joi.number().integer().min(0).default(250),
  HCM_SYNC_SERVICE_TOKEN: Joi.string().min(16).required(),
  HCM_SYNC_SIGNING_SECRET: Joi.string().min(16).optional(),
  HCM_SYNC_SIGNATURE_TTL_SECONDS: Joi.number().integer().min(30).default(300),
});
