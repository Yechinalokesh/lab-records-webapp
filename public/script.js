document.getElementById('labRecordForm').addEventListener('submit', function (event) {
    event.preventDefault(); // Prevent the form from reloading the page

    // Get the values from the form
    const studentName = document.getElementById('studentName').value;
    const labName = document.getElementById('labName').value;
    const submissionDate = document.getElementById('submissionDate').value;

    // Create the data to send in the POST request
    const data = {
        studentName: studentName,
        labName: labName,
        submissionDate: submissionDate
    };

    // Send a POST request to the server
    fetch('http://localhost:3000/add-record', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        // Show a success message
        document.getElementById('responseMessage').innerText = data.message;
    })
    .catch((error) => {
        console.error('Error:', error);
        document.getElementById('responseMessage').innerText = "There was an error submitting the record.";
    });
});
