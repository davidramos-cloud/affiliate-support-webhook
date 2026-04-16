const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Freshdesk config
const FRESHDESK_DOMAIN = "gohighlevelassist.freshdesk.com";
const FRESHDESK_API_KEY = process.env.FRESHDESK_API_KEY;

// LeadConnector webhook URL
const LC_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/knES3eSWYIsc5YSZ3YLl/webhook-trigger/773a3c58-eb38-40ee-9708-0f58f5e0c943";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "affiliate-support-webhook",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

// Main webhook endpoint
app.post("/webhook/affiliate-support", async (req, res) => {
  const receivedAt = new Date().toISOString();
  console.log(`[${receivedAt}] Received affiliate support form submission`);

  try {
    const body = req.body;

    // Log full payload for debugging
    console.log(`[${receivedAt}] Full payload:`, JSON.stringify(body, null, 2));

    // --- Helper: find a value by checking multiple keys (case-insensitive) ---
    // HighLevel sends form data using the field labels as keys, which can vary
    // in casing and formatting (spaces, slashes, underscores, etc.).
    function findField(obj, ...candidateKeys) {
      // 1. Try exact matches first
      for (const key of candidateKeys) {
        if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
          return obj[key];
        }
      }
      // 2. Try case-insensitive match against all keys in the payload
      const lowerCandidates = candidateKeys.map((k) => k.toLowerCase());
      for (const objKey of Object.keys(obj)) {
        const lowerObjKey = objKey.toLowerCase();
        for (const candidate of lowerCandidates) {
          if (lowerObjKey === candidate) {
            if (obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== "") {
              return obj[objKey];
            }
          }
        }
      }
      // 3. Try partial/fuzzy match -- check if any payload key contains a candidate
      for (const objKey of Object.keys(obj)) {
        const normalized = objKey.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const candidate of lowerCandidates) {
          const normCandidate = candidate.replace(/[^a-z0-9]/g, "");
          if (normalized.includes(normCandidate) || normCandidate.includes(normalized)) {
            if (obj[objKey] !== undefined && obj[objKey] !== null && obj[objKey] !== "") {
              return obj[objKey];
            }
          }
        }
      }
      return "";
    }

    // --- Helper: extract from customData array (HighLevel sometimes nests here) ---
    function findInCustomData(customData, ...candidateKeys) {
      if (!Array.isArray(customData)) return "";
      const lowerCandidates = candidateKeys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ""));
      for (const item of customData) {
        const label = (item.label || item.field_key || item.key || item.name || item.id || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        for (const candidate of lowerCandidates) {
          if (label.includes(candidate) || candidate.includes(label)) {
            if (item.value !== undefined && item.value !== null && item.value !== "") {
              return item.value;
            }
          }
        }
      }
      return "";
    }

    const customData = body.customData || body.custom_data || body.others || [];

    // Extract form fields -- checking body keys, nested contact, and customData
    const firstName =
      findField(body, "first_name", "firstName", "First Name") ||
      body.contact?.first_name ||
      body.contact?.firstName ||
      findInCustomData(customData, "first_name", "firstname") ||
      "";

    const lastName =
      findField(body, "last_name", "lastName", "Last Name") ||
      body.contact?.last_name ||
      body.contact?.lastName ||
      findInCustomData(customData, "last_name", "lastname") ||
      "";

    const fullName =
      findField(body, "full_name", "fullName", "name") ||
      body.contact?.name ||
      body.contact?.full_name ||
      (firstName || lastName ? `${firstName} ${lastName}`.trim() : "") ||
      "Unknown";

    const email =
      findField(body, "email", "Email") ||
      body.contact?.email ||
      findInCustomData(customData, "email") ||
      "";

    const affiliateEmail =
      findField(body, "affiliate_email", "affiliateEmail", "Affiliate Email") ||
      findInCustomData(customData, "affiliateemail", "affiliate_email") ||
      email ||
      "";

    const affiliateLink =
      findField(body, "affiliate_link", "affiliateLink", "Your Affiliate Link", "your_affiliate_link", "Affiliate Link") ||
      findInCustomData(customData, "affiliatelink", "affiliate_link", "youraffiliatelink") ||
      "";

    const requestType =
      findField(body, "type_of_affiliate_request", "typeOfAffiliateRequest", "request_type",
        "Type of Affiliate Request", "Affiliate Support Requestion (Selected)",
        "affiliate_support_requestion_selected", "type_of_request") ||
      findInCustomData(customData, "typeofaffiliaterequest", "requesttype", "affiliaterequest") ||
      "";

    const otherDetails =
      findField(body, "other_details", "otherDetails", "details", "message",
        "Other/ Additional Details", "Other/Additional Details", "other_additional_details",
        "Additional Details", "additional_details") ||
      findInCustomData(customData, "otherdetails", "other_details", "additionaldetails", "otheradditionaldetails") ||
      "";

    const attachments =
      findField(body, "attachments", "attachment", "Attachments? (If provided)", "Attachments") ||
      findInCustomData(customData, "attachments", "attachment") ||
      "";

    const locationId =
      findField(body, "location_id", "locationId", "location.id") ||
      body.location?.id ||
      "";

    const contactId =
      findField(body, "contact_id", "contactId", "contact.id") ||
      body.contact?.id ||
      "";

    const ccEmail =
      findField(body, "cc_email", "ccEmail", "cc", "Add a C C Email to Your",
        "add_a_cc_email", "cc_emails", "Add a CC Email") ||
      findInCustomData(customData, "ccemail", "cc_email", "addaccemail") ||
      "";

    const timezone =
      findField(body, "timezone", "Timezone", "time_zone", "timeZone") ||
      body.contact?.timezone ||
      findInCustomData(customData, "timezone") ||
      "";

    console.log(`[${receivedAt}] Extracted fields:`, JSON.stringify({
      fullName, email, affiliateEmail, affiliateLink,
      requestType, otherDetails, ccEmail, locationId, contactId, timezone
    }, null, 2));

    // Build the description HTML to match Zapier format with proper line breaks
    const contactUrl =
      locationId && contactId
        ? `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`
        : "N/A";

    const descriptionHtml = [
      `[Name]: ${fullName}`,
      `[Affiliate Email]: ${affiliateEmail}`,
      `[Affiliate Link]: ${affiliateLink}`,
      `[Affiliate Support Requestion (Selected)]: ${requestType}`,
      `[Other Details Provided]: ${otherDetails}`,
      `[Attachments? (If provided)]: ${attachments}`,
      ``,
      ``,
      `-----Contact in HL Account from Form Submission-----`,
      `[Location ID]: ${locationId}`,
      `[Contact ID]: ${contactId}`,
      `Contact URL: <a href="${contactUrl}">${contactUrl}</a>`,
    ].join("<br>");

    console.log(`Creating Freshdesk ticket for: ${email}`);

    // Build Freshdesk ticket payload
    const ticketPayload = {
      subject: `[Affiliate Support Form] By ${email}`,
      email: email || "no-reply@gohighlevel.com",
      name: fullName,
      type: "L1 - Frontline",
      priority: 3,
      description: descriptionHtml,
      tags: ["FDZ-18: Affiliate Support Form"],
      status: 2,
    };

    // Add CC emails if provided
    if (ccEmail) {
      const ccList = ccEmail
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      if (ccList.length > 0) {
        ticketPayload.cc_emails = ccList;
      }
    }

    // Create Freshdesk ticket
    const freshdeskAuth = Buffer.from(`${FRESHDESK_API_KEY}:X`).toString(
      "base64"
    );

    const freshdeskResponse = await axios.post(
      `https://${FRESHDESK_DOMAIN}/api/v2/tickets`,
      ticketPayload,
      {
        headers: {
          Authorization: `Basic ${freshdeskAuth}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const ticketId = freshdeskResponse.data.id;
    console.log(`Freshdesk ticket created: #${ticketId}`);

    // POST to LeadConnector webhook
    const lcPayload = {
      ticket_id: ticketId,
      affiliate_email: affiliateEmail || email,
    };

    console.log(`Posting to LeadConnector webhook...`);

    await axios.post(LC_WEBHOOK_URL, lcPayload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    console.log(`LeadConnector webhook notified successfully`);

    // Return success
    res.status(200).json({
      success: true,
      ticket_id: ticketId,
      ticket_url: `https://${FRESHDESK_DOMAIN}/a/tickets/${ticketId}`,
      message: "Freshdesk ticket created and LeadConnector notified",
    });
  } catch (error) {
    console.error("Error processing webhook:", error.message);

    if (error.response) {
      console.error("API Response Status:", error.response.status);
      console.error("API Response Data:", JSON.stringify(error.response.data));
    }

    res.status(error.response?.status >= 500 ? 502 : 500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null,
    });
  }
});

// Catch-all for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    hint: "POST to /webhook/affiliate-support",
  });
});

app.listen(PORT, () => {
  console.log(`Affiliate Support Webhook running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/affiliate-support`);
});
