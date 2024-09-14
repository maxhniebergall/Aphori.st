import React, { useState } from 'react';

function App() {
    const username = "root"
    const [statementText, setStatementText] = useState('');
    const [tags, setTags] = useState('');
    const [retrievedValue, setRetrievedValue] = useState('');
    const [retrievalKey, setRetrievalKey] = useState('');

    const handleSetValue = async () => {
        try {
            const response = await fetch(`${process.env.REACT_APP_API_URL}/api/setValue`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({"value": statementText, "key": username}),
            });

            if (response.ok) {
                alert('Value set successfully!');
            } else {
                alert("failed to set value")
                console.log(response);
            }
        } catch (error) {
            console.error('Error setting value:', error);
        }
    };

    const handleGetValue = async () => {
        try {
            const response = await fetch(`${process.env.REACT_APP_API_URL}/api/getValue/${retrievalKey}`);

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

      // Handle checkbox change
    const handleChange = (event) => {
        const { name, checked } = event.target;
        setTags((prevTags) => ({
        ...prevTags,
        [name]: checked,
        }));
    };

    return (
        <div className="App">
            <h1>Set and Get Value from Redis</h1>

            <div>
                <input
                    type="text"
                    placeholder="Life is a sequence of aphorisms..."
                    value={statementText}
                    onChange={(e) => setStatementText(e.target.value)}
                />
                <fieldset>
                <legend>Select a tag:</legend>
                    <div>
                        <input
                            type="radio"
                            name="type"
                            value = "Aphorism"
                            checked
                            onChange={handleChange}
                        />
                        <label>
                        Aphorism
                        </label>
                    </div>
                    <div>
                        <input
                            type="radio"
                            name="type"
                            value = "Comment"
                            onChange={handleChange}
                        />
                        <label>
                        Comment
                        </label>
                    </div>
                </fieldset>
                <button onClick={handleSetValue}>Set Value</button>
            </div>
            <b/>
            <div>
                <input
                    type="text"
                    placeholder="Enter Key to Retrieve"
                    value={retrievalKey}
                    onChange={(e) => setRetrievalKey(e.target.value)}
                />
                <button onClick={handleGetValue}>Get Value</button>
                <b/>
                {retrievedValue && <p>Retrieved Value: {retrievedValue}</p>}
            </div>
        </div>
    );
}

export default App;
