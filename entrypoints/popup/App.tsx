import { Toggle, Setting, Card } from '@/components';

function App() {

  const iconSize = 35;

  const footerDetailsOnClick = () => {
    // Add later
  }
  const footerAllowlistOnClick = () => {
    // Add later
  }

  return (
    <>
      <div className='header'>
        <h1 className='title'>
          <span className='title-red'>Lion</span>
          <span className='title-black'>Guard</span>
        </h1>
        <div className='header-right'>
          <Setting size={iconSize} />
          <Toggle size={iconSize} />
        </div>
      </div>
      <div className='body'>
        <Card title="Sites flagged" count="12" />
        <Card title="PII warning" count="3" />
        <Card title="Breach check" count="0" />
      </div>
      <div className='footer'>
        <button className='footer-details-button' onClick={footerDetailsOnClick}>View Details</button>
        <button className='footer-allowlist-button' onClick={footerAllowlistOnClick}>Allowlist</button>
      </div>
    </>
  );
}

export default App;
