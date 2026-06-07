"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { POLLING_INTERVAL_MS } from "../utils/constants.js";

export function useUpload() {
  const [file, setFile] = useState(null);
  const [reportType, setReportType] = useState("other");
  const [uploading, setUploading] = useState(false);
  const [recordId, setRecordId] = useState(null);
  const [processingStatus, setProcessingStatus] = useState(null);
  const [processingError, setProcessingError] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const pollRef = useRef(null);
  const isMountedRef = useRef(true);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id) => {
      stopPolling();
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 3;

      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/records/${id}/status`);
          if (!res.ok) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error("[useUpload] Polling failed after multiple errors");
              stopPolling();
              if (isMountedRef.current) {
                setProcessingError("Failed to fetch processing status");
                setProcessingStatus("failed");
              }
            }
            return;
          }
          consecutiveErrors = 0; // reset on success
          const data = await res.json();

          if (isMountedRef.current) {
            setProcessingStatus(data.processingStatus);

            if (data.processingStatus === "completed" || data.processingStatus === "failed") {
              stopPolling();
              if (data.processingStatus === "failed") {
                setProcessingError(data.processingError || "Processing failed");
              }
            }
          }
        } catch (err) {
          console.error("[useUpload] Polling error:", err);
          consecutiveErrors++;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            stopPolling();
            if (isMountedRef.current) {
              setProcessingError("Network error while polling");
              setProcessingStatus("failed");
            }
          }
        }
      }, POLLING_INTERVAL_MS);
    },
    [stopPolling]
  );

  const uploadFile = useCallback(
    async (patientId) => {
      // Prevent concurrent uploads
      if (uploading) {
        setUploadError("Upload already in progress");
        return;
      }

      if (!file) {
        setUploadError("Please select a PDF file");
        return;
      }

      // Optional client-side file type validation
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setUploadError("Only PDF files are allowed");
        return;
      }

      // Stop any previous polling and reset state
      stopPolling();
      setUploading(true);
      setUploadError(null);
      setProcessingError(null);
      setRecordId(null);
      setProcessingStatus(null);

      const formData = new FormData();
      formData.append("file", file);
      formData.append("reportType", reportType);
      if (patientId) formData.append("patientId", patientId);

      let newRecordId = null;

      try {
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");

        newRecordId = data.recordId;
        setRecordId(newRecordId);
        setProcessingStatus("uploading");

        // Start processing the file
        const processRes = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: newRecordId }),
        });

        if (!processRes.ok) {
          const processError = await processRes.json();
          throw new Error(processError.error || "Failed to start processing");
        }

        // Only start polling after processing started successfully
        startPolling(newRecordId);
      } catch (err) {
        // If processing failed, ensure polling doesn't start
        stopPolling();
        setUploadError(err.message);
        setProcessingStatus(null);
        setRecordId(null);
      } finally {
        if (isMountedRef.current) {
          setUploading(false);
        }
      }
    },
    [file, reportType, uploading, stopPolling, startPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    setFile(null);
    setReportType("other");
    setUploading(false);
    setRecordId(null);
    setProcessingStatus(null);
    setProcessingError(null);
    setUploadError(null);
  }, [stopPolling]);

  return {
    file,
    setFile,
    reportType,
    setReportType,
    uploading,
    recordId,
    processingStatus,
    processingError,
    uploadError,
    uploadFile,
    reset,
  };
}