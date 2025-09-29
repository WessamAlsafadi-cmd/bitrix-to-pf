import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const BITRIX_BASE = "https://tlre.bitrix24.com/rest/17/q49rh3i333ywswgp";

// Fetch field metadata (labels, types, enum values, etc.)
async function getFieldDefinitions(entityTypeId) {
  const url = `${BITRIX_BASE}/crm.item.fields.json`;
  const res = await axios.post(url, { entityTypeId });
  // Only return the "fields" object
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
      // Multiple or other fields
      else {
        output[label] = value;
      }
    } else {
      // Fields without metadata, keep original key
      output[key] = value;
    }
  }

  return output;
}

// Webhook listener
app.post("/webhook", async (req, res) => {
  try {
    console.log("Incoming webhook payload:", req.body);

    // Parse entityTypeId and itemId from document_id
    const [, , dynamicId] = req.body.document_id;
    const [, entityTypeId, itemId] = dynamicId.split("_");

    console.log(`Parsed entityTypeId=${entityTypeId}, itemId=${itemId}`);

    // Fetch metadata and item data
    const fieldsMeta = await getFieldDefinitions(entityTypeId);
    const item = await getItem(entityTypeId, itemId);

    // Transform raw data into labels
    const cleanData = transformItem(item, fieldsMeta);

    console.log("Transformed item:", cleanData);
    res.json(cleanData);
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.status(500).send(error.toString());
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
