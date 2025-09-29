import express from "express";
import axios from "axios";

const app = express();

// Parse URL-encoded bodies (Bitrix sends payload as x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true }));

const BITRIX_BASE = "https://tlre.bitrix24.com/rest/17/q49rh3i333ywswgp";

// Fetch field metadata (labels, types, enum values, etc.)
async function getFieldDefinitions(entityTypeId) {
  const url = `${BITRIX_BASE}/crm.item.fields.json`;
  const res = await axios.post(url, { entityTypeId });
  return res.data.result.fields;
}

// Fetch the actual CRM item data
async function getItem(entityTypeId, itemId) {
  const url = `${BITRIX_BASE}/crm.item.get.json`;
  const res = await axios.post(url, { entityTypeId, id: itemId });
  return res.data.result.item;
}

// Transform raw data into human-readable labels
function transformItem(item, fieldsMeta) {
  const output = {};

  for (const key in item) {
    const value = item[key];

    if (fieldsMeta[key]) {
      const meta = fieldsMeta[key];
      const label = meta.title || key;

      // Enumerations
      if (meta.type === "enumeration") {
        if (Array.isArray(value)) {
          output[label] = value.map(
            v => meta.items.find(opt => String(opt.ID) === String(v))?.VALUE || v
          );
        } else {
          output[label] = meta.items.find(opt => String(opt.ID) === String(value))?.VALUE || value;
        }
      }
      // File fields
      else if (meta.type === "file") {
        if (Array.isArray(value)) {
          output[label] = value.map(f => f.url || f.urlMachine || f);
        } else {
          output[label] = value.url || value.urlMachine || value;
        }
      }
      // All other fields
      else {
        output[label] = value;
      }
    } else {
      output[key] = value;
    }
  }

  return output;
}

// Webhook listener
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    console.log("Incoming webhook payload:", payload);

    // Bitrix sends document_id as comma-separated string
    const document_id_raw = payload.document_id;
    let document_id;

    if (typeof document_id_raw === "string") {
      document_id = document_id_raw.split(",");
    } else {
      document_id = document_id_raw; // already an array
    }

    const [, , dynamicId] = document_id;
    const [, entityTypeId, itemId] = dynamicId.split("_");

    console.log(`Parsed entityTypeId=${entityTypeId}, itemId=${itemId}`);

    const fieldsMeta = await getFieldDefinitions(entityTypeId);
    const item = await getItem(entityTypeId, itemId);
    const cleanData = transformItem(item, fieldsMeta);

    console.log("Transformed item:", cleanData);

    res.json({ success: true, data: cleanData });
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.status(500).send(error.toString());
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
