-- Reviewed seed for the shared sage-nyc-admin target.
-- Idempotent: creates or re-enables only the Gemini provider/model required by
-- Prompt Studio, then adds that provider to the private execution allowlist.
BEGIN;
INSERT INTO public.llm_providers(slug,name,website_url,enabled)
VALUES ('gemini','Google Gemini','https://ai.google.dev/',true)
ON CONFLICT (slug) DO UPDATE SET enabled=true;
INSERT INTO public.llm_models(provider_id,model_key,display_name,enabled)
SELECT id,'gemini-3.5-flash-lite','Gemini 3.5 Flash Lite',true
FROM public.llm_providers WHERE slug='gemini'
ON CONFLICT (provider_id,model_key) DO UPDATE SET enabled=true;
INSERT INTO prompt_tool.gemini_providers(provider_id)
SELECT id FROM public.llm_providers WHERE slug='gemini'
ON CONFLICT DO NOTHING;
COMMIT;
