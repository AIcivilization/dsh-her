import assert from 'node:assert/strict'
import { test } from 'node:test'
import { designArg, insideZip, translocated } from '../body/main/standalone-where.ts'

test('真人桌宠 knows when it was started from the wrong place, and what it was started with', () => {
  // Windows: a double click inside a zip runs the one file out of Temp.
  assert.equal(insideZip('C:\\Users\\a\\AppData\\Local\\Temp\\Temp1_真人桌宠.zip\\真人桌宠\\真人桌宠.exe', 'C:\\Users\\a\\AppData\\Local\\Temp', 'win32'), true)
  assert.equal(insideZip('c:/users/a/appdata/local/temp/7zO1/真人桌宠.exe', 'C:\\Users\\a\\AppData\\Local\\Temp\\', 'win32'), true)
  assert.equal(insideZip('D:\\应用\\真人桌宠\\真人桌宠.exe', 'C:\\Users\\a\\AppData\\Local\\Temp', 'win32'), false)
  assert.equal(insideZip('C:\\Users\\a\\AppData\\Local\\Temporary\\真人桌宠.exe', 'C:\\Users\\a\\AppData\\Local\\Temp', 'win32'), false)
  assert.equal(insideZip('/private/var/folders/x/T/真人桌宠.app/Contents/MacOS/真人桌宠', '/private/var/folders/x/T', 'darwin'), false)
  // macOS: run from a random place until it has been moved.
  assert.equal(translocated('/private/var/folders/ab/T/AppTranslocation/1234/d/真人桌宠.app/Contents/MacOS/真人桌宠'), true)
  assert.equal(translocated('/Applications/真人桌宠.app/Contents/MacOS/真人桌宠'), false)
  // A 设计包 double-clicked comes as an argument; the program itself and its flags are not one.
  assert.equal(designArg(['C:\\真人桌宠\\真人桌宠.exe', 'D:\\下载\\小禾.her']), 'D:\\下载\\小禾.her')
  assert.equal(designArg(['electron', '.', '--standalone', '--home', '/tmp/x', '/tmp/小禾.ZIP']), '/tmp/小禾.ZIP')
  assert.equal(designArg(['/tmp/app.zip', '--standalone']), undefined)
})
