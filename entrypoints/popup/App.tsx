import { Toggle, Setting, Card } from '@/components';
import { Trash } from 'lucide-react';
import { useState } from 'react';

type Page = 'home' | 'details' | 'allowlist' | 'settings';

function App() {

  const iconSize = 35;
  const iconSizeSmall = 25;
  const [currentPage, setCurrentPage] = useState<Page>('home');


  const footerDetailsOnClick = () => {
    setCurrentPage('details');
  }

  const footerAllowlistOnClick = () => {
    setCurrentPage('allowlist');
  }

  const handleSettingsClick = () => {
    setCurrentPage('settings');
  }

  const handleBackToHome = () => {
    setCurrentPage('home');
  }

  // Settings page
  if (currentPage === 'settings') {
    return (
      <>
        <div className='header'>
          <h1 className='title'>
            <span className='title-red'>Lion</span>
            <span className='title-black'>Guard</span>
          </h1>
          <div className='header-right'>
            <button onClick={handleBackToHome} className='back-button'>Back</button>
          </div>
        </div>
        <div className='settings'>
          <h2 className='settings-title'>Settings</h2>
          <div className='settings-content'>
            <div className="settings-pii">
              <p>PII Detection</p>
              <Toggle size={iconSize} />
            </div>
            <div className="settings-url">
              <p>URL Reputation Check</p>
              <Toggle size={iconSize} />
            </div>
          </div>
        </div>
        <div className='allowlist'>
          <h2 className='allowlist-title'>Allowlist</h2>
          <div className='allowlist-content'>
            <div className="allowlist-item">
              <p>https://www.google.com</p>
              <button className='allowlist-item-button'>
                <Trash size={iconSizeSmall} />
              </button>
            </div>
          </div>
        </div>
        <div className='footer'>
          <button className='footer-export'>Export</button>
          <button className='footer-uninstall'>Uninstall</button>
        </div>
      </>
    );
  }

  // Details page
  if (currentPage === 'details') {
    return (
      <div>
        <div className='header'>
          <button onClick={handleBackToHome} className='back-button'>← Back</button>
          <h1 className='title'>
            <span className='title-red'>Details</span>
          </h1>
        </div>
        <div className='body'>
          <h2>Detailed Information</h2>
          <p>Here are the details about flagged sites...</p>
          {/* Add your details content here */}
        </div>
      </div>
    );
  }

  // Allowlist page
  if (currentPage === 'allowlist') {
    return (
      <div>
        <div className='header'>
          <button onClick={handleBackToHome} className='back-button'>← Back</button>
          <h1 className='title'>
            <span className='title-red'>Allowlist</span>
          </h1>
        </div>
        <div className='body'>
          <h2>Manage Allowlist</h2>
          <p>Manage your allowed sites here...</p>
          {/* Add your allowlist content here */}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className='header'>
        <h1 className='title'>
          <span className='title-red'>Lion</span>
          <span className='title-black'>Guard</span>
        </h1>
        <div className='header-right'>
          <Setting size={iconSize} onClick={handleSettingsClick} />
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
