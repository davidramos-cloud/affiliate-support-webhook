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

    // Extract form fields
    const fullName =
      body.full_name ||
      body.fullName ||
      body.name ||
      body.contact?.name ||
      body.first_name
        ? `${body.first_name || ""} ${body.last_name || ""}`.trim()
        : "Unknown";

    const email =
      body.email ||
      body.affiliate_email ||
      body.contact?.email ||
      "";

    const affiliateEmail =
      body.affiliate_email ||
      body.email ||
      "";

    const affiliateLink =
      body.affiliate_link ||
      body.affiliateLink ||
      "";

    const requestType =
      body.type_of_affiliate_request ||
      body.typeOfAffiliateRequest ||
      body.request_type ||
      "";

    const otherDetails =
      body.other_details ||
      body.otherDetails ||
      body.details ||
      body.message ||
      "";

    const attachments =
      body.attachments ||
      body.attachment ||
      "";

    const locationId =
      body.location_id ||
      body.locationId ||
      body.location?.id ||
      "";

    const contactId =
      body.contact_id ||
      body.contactId ||
      body.contact?.id ||
      "";

    const ccEmail =
      body.cc_email ||
      body.ccEmail ||
      body.cc ||
      "";

    // Build description HTML with proper line breaks
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
