# Form Instructions

When working on forms in this project, first understand what elements are required for the form. Then, generate a form JSON following the schema below in the docs/forms folder.

Next, ask the user to visit <https://svelte-form-builder.vercel.app/v2> and import the form JSON into the form builder. Follow the instructions on the page to build the form with valibot validation and SvelteKit remote functions toggled on! Use btca to get more information about SvelteKit remote functions. The user will then provide the generated client and server code. Implement the form in the project using the generated code, and make sure to use the shadcn-svelte components for the form elements instead of custom error labels.

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
