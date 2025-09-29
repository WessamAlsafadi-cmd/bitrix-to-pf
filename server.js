import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const BITRIX_BASE = "https://tlre.bitrix24.com/rest/17/q49rh3i333ywswgp";

async function getFieldDefinitions(entityTypeId) {
  const url = `${BITRIX_BASE}/crm.item.fields.json`;
  const res = await axios.post(url, { entityTypeId });
  return res.data.result;
}

async function getItem(entityTypeId, itemId) {
  const url = `${BITRIX_BASE}/crm.item.get.json`;
  const res = await axios.post(url, { entityTypeId, id: itemId });
  return res.data.result.item;
}

function transformItem(item, fieldsMeta) {
  const output = {};
  for (const key in item) {
    const value = item[key];
    if (fieldsMeta[key]) {
      const meta = fieldsMeta[key];
      const label = meta.title || key;

      if (meta.type === "enumeration") {
        if (Array.isArray(value)) {
          output[label] = value.map(
            v => meta.items.find(opt => String(opt.ID) === String(v))?.VALUE || v
          );
        } else {
          output[label] = meta.items.find(opt => String(opt.ID) === String(value))?.VALUE || value;
        }
      } else {
        output[label] = value;
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}

app.post("/webhook", async (req, res) => {
  try {
    const { entityTypeId, id: itemId } = req.body;

    const fieldsMeta = await getFieldDefinitions(entityTypeId);
    const item = await getItem(entityTypeId, itemId);

    const cleanData = transformItem(item, fieldsMeta);
    res.json(cleanData);
  } catch (error) {
    res.status(500).send(error.toString());
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
