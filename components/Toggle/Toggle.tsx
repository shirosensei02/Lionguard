import { ToggleLeft, ToggleRight } from 'lucide-react'
import { useState } from 'react';

function Toggle({size}: {size: number}) {
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
            {isOn ? <ToggleRight size={size}/> : <ToggleLeft size={size}/>}
        </button>
    )
}

export { Toggle };