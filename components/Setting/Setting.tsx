import { Settings } from 'lucide-react';
import { useState } from 'react';

function Setting({ size }: { size: number }) {
    const handleClick = () => {

    }
    return (
        <button onClick={handleClick}>
            <Settings size={size} />
        </button>
    )
}

export { Setting };