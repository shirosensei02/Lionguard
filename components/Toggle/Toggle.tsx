import { ToggleLeft, ToggleRight } from 'lucide-react'
import { useState } from 'react';

function Toggle() {
    const [isOn, setIsOn] = useState(false);
    const toggle = () => {
        setIsOn(!isOn);
    }
    const handleClick = () => {
        toggle();
        console.log(isOn);
    }
    return (
        <button onClick={handleClick}>
            {isOn ? <ToggleRight size={40}/> : <ToggleLeft size={40}/>}
        </button>
    )
}

export { Toggle };