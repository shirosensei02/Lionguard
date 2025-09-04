function Card({ title, count }: { title: string, count: string }) {

    return (
        <div className='card'>
            <h2 className='card-title'>{title}</h2>
            <p className='card-count'>{count}</p>
        </div>
    )
}

export { Card };