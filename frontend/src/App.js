import React, { useState } from 'react';

function App() {
    const [key, setKey] = useState('');
    const [value, setValue] = useState('');
    const [retrievedValue, setRetrievedValue] = useState('');
    const [retrievalKey, setRetrievalKey] = useState('');

    const handleSetValue = async () => {
        try {
            const response = await fetch('/api/setValue', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ key, value }),
            });

            if (response.ok) {
                alert('Value set successfully!');
                setKey('');
                setValue('');
            } else {
                alert('Failed to set value.');
            }
        } catch (error) {
            console.error('Error setting value:', error);
        }
    };

    const handleGetValue = async () => {
        try {
            const response = await fetch(`/api/getValue/${retrievalKey}`);

            if (response.ok) {
                const data = await response.json();
                setRetrievedValue(data.value || 'Key not found');
            } else {
                alert('Failed to retrieve value.');
            }
        } catch (error) {
            console.error('Error retrieving value:', error);
        }
    };

    return (
        <div className="App">
            <h1>Set and Get Value from Redis</h1>

            <div>
                <input
                    type="text"
                    placeholder="Enter Key"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                />
                <input
                    type="text"
                    placeholder="Enter Value"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                />
                <button onClick={handleSetValue}>Set Value</button>
            </div>

            <div>
                <input
                    type="text"
                    placeholder="Enter Key to Retrieve"
                    value={retrievalKey}
                    onChange={(e) => setRetrievalKey(e.target.value)}
                />
                <button onClick={handleGetValue}>Get Value</button>
                {retrievedValue && <p>Retrieved Value: {retrievedValue}</p>}
            </div>
        </div>
    );
}

export default App;
