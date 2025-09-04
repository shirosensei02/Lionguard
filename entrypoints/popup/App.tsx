import { Toggle, Setting } from '@/components';

function App() {

  const iconSize = 35;

  return (
    <>
      <div className='header'>
        <h1 className='title'>
          <span className='title-red'>Lion</span>
          <span className='title-black'>Guard</span>
        </h1>
        <Setting size={iconSize} />
        <Toggle size={iconSize} />
      </div>
      <div className='card'>
      </div>
    </>
  );
}

export default App;
