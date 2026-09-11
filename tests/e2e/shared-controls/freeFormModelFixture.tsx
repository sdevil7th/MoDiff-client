import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AutocompleteField from '../../../src/fields/AutocompleteField';

export default function EditableModel() {
  const [value, setValue] = useState<unknown>('InstantX/Canny');
  return (
    <>
      <button type="button">After repository</button>
      <AutocompleteField
        nodeId="free-form-model-regression"
        fieldKey="model_id"
        label="Editable repository"
        display="autocomplete"
        disabled={false}
        hidden={false}
        style={{}}
        value={value}
        default=""
        options={['ACE-Step/Unrelated', 'InstantX/Canny', 'InstantX/Union']}
        dataType="string"
        fieldType="param"
        module="test"
        action="test"
        fieldOptions={{ noValidation: true }}
        updateStore={(_key, next) => setValue(next)}
      />
      <output data-testid="selected-repository">{String(value)}</output>
    </>
  );
}

function mountEditableModel() {
  const host = document.createElement('section');
  document.body.prepend(host);
  createRoot(host).render(<EditableModel />);
}

mountEditableModel();
