# Form Instructions

This document applies only to forms that will be implemented with SvelteKit remote functions (`form(schema, handler)`).

Before using this workflow, confirm the form is a remote-form candidate via `AGENTS.md` (Forms decision tree).

When working on a remote form in this project:

1. Understand the fields and validation requirements.
2. Generate a form JSON following the schema below in `docs/forms/`.
3. Ask the user to visit <https://svelte-form-builder.vercel.app/v2> and import the JSON.
4. In the builder, ensure Valibot validation and SvelteKit remote functions are toggled on.
5. Use btca to verify up-to-date SvelteKit remote-function patterns when needed.
6. Implement the generated client/server code in the project, preserving existing UI structure and using shadcn-svelte components.

Note: This document is intentionally scoped to remote-function forms only.

## Form Builder Import

Generate a form JSON structure for my Svelte form builder. Use this exact schema:

**Schema:**

- Return an array of rows
- Each row has: "id" (string), "fields" (array)
- Each field must have:
  - "id": unique string (e.g., "field-1")
  - "name": display name (e.g., "Input", "Email")
  - "type": field type (text, email, password, number, textarea, boolean, select, radio, date-picker, slider, input-otp, phone, combobox, tags-input, file, location-input)
  - "category": same as type for most fields, or "checkbox"/"switch" for boolean
  - "label": field label shown to user
  - "description": helper text (optional)
  - "placeholder": placeholder text
  - "required": boolean
  - "position": "full" (or "left"/"right" for side-by-side, max 2 per row)
  - "options": array for select/radio/combobox (each with "id", "value", "label")
  - "multiple": boolean (optional) for select/combobox (false=single, true=multiple)

**Example:**

```json
[
	{
		"id": "row-1",
		"fields": [
			{
				"id": "field-1",
				"name": "Input",
				"type": "text",
				"category": "text",
				"label": "Full Name",
				"description": "Enter your full name",
				"placeholder": "John Doe",
				"required": true,
				"position": "full"
			}
		]
	}
]
```

**My Requirements:**
[Paste your form requirements here - e.g., "Create a contact form with name, email, phone, and message fields"]
