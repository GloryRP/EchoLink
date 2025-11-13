import React, { useContext, useState } from 'react';
import withAuth from '../utils/withAuth';
import { useNavigate } from 'react-router-dom';
import "../App.css";
import { Button, IconButton, TextField } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import { AuthContext } from '../contexts/AuthContext';
import axios from 'axios';
import server from '../environment';

function HomeComponent() {
    const navigate = useNavigate();
    const { addToUserHistory } = useContext(AuthContext);

    // Controlled input: default to empty string
    const [meetingCode, setMeetingCode] = useState("");  
    const [creatingMeeting, setCreatingMeeting] = useState(false);
    const [hostMeetingCode, setHostMeetingCode] = useState("");

    const token = localStorage.getItem("token"); // token read once

    // Join an existing meeting
    const handleJoinVideoCall = async () => {
        if (!meetingCode.trim()) return alert("Enter a meeting code!");
        if (!token) {
            alert("Token missing! Please login again.");
            navigate("/auth");
            return;
        }

        try {
            await axios.post(`${server}/api/v1/meetings/join`, {
                token,
                meetingCode: meetingCode.trim()
            });

            await addToUserHistory(meetingCode.trim());
            navigate(`/${meetingCode.trim()}`);
        } catch (err) {
            console.error("Failed to join meeting:", err.response?.data || err);
            alert(err.response?.data?.message || "Failed to join meeting");
        }
    };

    // Create a new meeting as host
    const handleCreateMeeting = async () => {
        if (creatingMeeting) return;
        if (!token) {
            alert("Token missing! Please login again.");
            navigate("/auth");
            return;
        }

        try {
            setCreatingMeeting(true);

            const response = await axios.post(`${server}/api/v1/meetings/create`, { token });
            const newCode = response.data.meetingCode;
            setHostMeetingCode(newCode);

            await addToUserHistory(newCode);
            navigate(`/${newCode}?host=true`);
        } catch (err) {
            console.error("Failed to create meeting:", err.response?.data || err);
            alert(err.response?.data?.message || "Failed to create meeting");
        } finally {
            setCreatingMeeting(false);
        }
    };

    return (
        <>
            <div className="navBar">
                <div style={{ display: "flex", alignItems: "center" }}>
                    <h2>EchoLink</h2>
                </div>

                <div style={{ display: "flex", alignItems: "center" }}>
                    <IconButton onClick={() => navigate("/history")}>
                        <RestoreIcon />
                    </IconButton>
                    <p>History</p>

                    <Button onClick={() => {
                        localStorage.removeItem("token");
                        navigate("/auth");
                    }}>
                        Logout
                    </Button>
                </div>
            </div>

            <div className="meetContainer">
                <div className="leftPanel">
                    <h2>Providing Quality Video Call Just Like Quality Education</h2>

                    <div style={{ display: 'flex', gap: "10px", marginBottom: "10px" }}>
                        <TextField
                            value={meetingCode}        // Controlled input
                            onChange={e => setMeetingCode(e.target.value)}
                            label="Meeting Code"
                            variant="outlined"
                        />
                        <Button onClick={handleJoinVideoCall} variant='contained'>Join</Button>
                    </div>

                    <div style={{ marginTop: "20px" }}>
                        <Button 
                            onClick={handleCreateMeeting} 
                            variant='contained' 
                            disabled={creatingMeeting}
                        >
                            {creatingMeeting ? "Creating..." : "Create Meeting"}
                        </Button>

                        {hostMeetingCode && !creatingMeeting && (
                            <p>Meeting created! Share this code: <b>{hostMeetingCode}</b></p>
                        )}
                    </div>
                </div>

                <div className='rightPanel'>
                    <img srcSet='/logo3.png' alt="Logo" />
                </div>
            </div>
        </>
    );
}

export default withAuth(HomeComponent);
