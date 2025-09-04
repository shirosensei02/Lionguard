import { useState } from 'react';
import { Toggle } from '@/components/Toggle';
import './App.css';

function App() {

  return (
    <>
      <div className='header'>
        <h1>PII Redact</h1>
        <Toggle/>
      </div>
      <div className='card'>
      </div>
    </>
  );
}

export default App;
