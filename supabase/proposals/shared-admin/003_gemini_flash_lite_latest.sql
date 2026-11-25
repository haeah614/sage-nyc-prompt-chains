-- Add the currently available Gemini model without changing the existing
-- model row used by any saved workflow or other shared application.
INSERT INTO public.llm_models(provider_id, model_key, display_name, enabled)
SELECT id, 'gemini-flash-lite-latest', 'Gemini Flash Lite (Latest)', true
FROM public.llm_providers
WHERE slug = 'gemini'
ON CONFLICT (provider_id, model_key) DO UPDATE
SET display_name = EXCLUDED.display_name, enabled = true;
