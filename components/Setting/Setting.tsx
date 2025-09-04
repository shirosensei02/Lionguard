import { Settings } from 'lucide-react';

function Setting({ size }: { size: number }) {
    const handleClick = () => {

    }

    return (
        <button onClick={handleClick}>
            <Settings className="setting" size={size} />
        </button>
    )
}

export { Setting };